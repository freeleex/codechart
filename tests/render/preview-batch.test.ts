import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkMapNodes, diffOf } from '../../src/render/check.js';
import { nodePreviews, parseDiff } from '../../src/render/preview.js';
import { gitFileDiffs } from '../../src/rules/git-files.js';
import { diffRange, gitFiles } from '../../src/rules/selection.js';
import type { Spec } from '../../src/spec/schema.js';

const calls = vi.hoisted(() => ({ list: [] as string[][] }));
vi.mock('node:child_process', async (orig) => {
  const m = await orig<typeof import('node:child_process')>();
  return {
    ...m,
    execFileSync: ((file: string, args: string[], ...rest: unknown[]) => {
      calls.list.push(args);
      return (m.execFileSync as (...a: unknown[]) => unknown)(file, args, ...rest);
    }) as typeof m.execFileSync,
  };
});
const countOf = (sub: string) => calls.list.filter((a) => a.includes(sub)).length;

let tmp: string;
let repo: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();
const write = (rel: string, text: string | Buffer) => {
  mkdirSync(join(repo, rel.split('/').slice(0, -1).join('/')), { recursive: true });
  writeFileSync(join(repo, rel), text);
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-batch-'));
  repo = join(tmp, 'repo');
  mkdirSync(repo);
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  git('config', 'commit.gpgsign', 'false');
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const MIX = ['src/plain.ts', 'my file.ts', 'héllo/ü.ts', 'a b/c -> d.ts', 'q"uote.ts', 'src/gone.ts', 'src/binary.bin', 'src/new.ts', '.env', 'src/same.ts'];

function seedMix() {
  for (const f of ['src/plain.ts', 'my file.ts', 'héllo/ü.ts', 'a b/c -> d.ts', 'q"uote.ts', 'src/gone.ts', 'src/same.ts']) write(f, 'one\ntwo\nthree\n');
  write('src/binary.bin', Buffer.from([0, 1, 2, 3]));
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  for (const f of ['src/plain.ts', 'my file.ts', 'héllo/ü.ts', 'a b/c -> d.ts', 'q"uote.ts']) write(f, 'one\nTWO\nthree\nfour\n');
  unlinkSync(join(repo, 'src/gone.ts'));
  write('src/binary.bin', Buffer.from([0, 9, 9, 9]));
  write('src/new.ts', 'x\ny\n');
  write('.env', 'TOKEN=1\n');
}

const specOf = (paths: string[]): Spec => ({
  title: 't',
  kind: 'summary',
  edges: [],
  nodes: paths.map((path, i) => ({ id: `n${i}`, label: `n${i}`, kind: 'file', layer: 'l', status: 'changed', path })),
});

const previews = (spec: Spec) => {
  const sel = { git: true };
  return nodePreviews(spec, repo, diffOf(gitFiles(repo, sel, true)), diffRange(repo, sel), checkMapNodes(spec, repo, {}).found);
};

describe('previews of many files', () => {
  it('match what one diff per file shows, for awkward names, deleted, untracked, binary and secret files', () => {
    seedMix();
    const out = previews(specOf(MIX));
    const alone = (path: string) => parseDiff(path, execFileSync('git', ['--literal-pathspecs', 'diff', '--no-color', '-U3', 'HEAD', '--', path], { cwd: repo }).toString());
    for (const path of ['src/plain.ts', 'my file.ts', 'héllo/ü.ts', 'a b/c -> d.ts', 'q"uote.ts', 'src/gone.ts']) {
      const node = MIX.indexOf(path);
      expect(out.get(`n${node}`), path).toEqual(alone(path));
      expect(out.get(`n${node}`)!.total, path).toBeGreaterThan(0);
    }
    expect(out.get('n6')).toMatchObject({ note: 'binary file', lines: [] });
    expect(out.get('n7')).toMatchObject({
      path: 'src/new.ts',
      shown: 2,
      total: 2,
      lines: [{ kind: 'hunk', text: '@@ -0,0 +1,2 @@' }, { kind: 'add', n: 1, text: 'x' }, { kind: 'add', n: 2, text: 'y' }],
    });
    expect(out.get('n8')).toMatchObject({ note: 'not shown: looks like a secret', lines: [] });
    expect(out.has('n9')).toBe(false);
  });

  it('cost a constant number of git diff, cat-file and ls-files calls', () => {
    seedMix();
    for (let i = 0; i < 30; i++) write(`many/f${i}.ts`, 'a\n');
    git('add', 'many');
    git('commit', '-q', '-m', 'many');
    for (let i = 0; i < 30; i++) write(`many/f${i}.ts`, 'a\nb\n');
    const spec = specOf([...MIX, ...Array.from({ length: 30 }, (_, i) => `many/f${i}.ts`)]);
    const sel = { git: true };
    const diff = diffOf(gitFiles(repo, sel, true));
    const range = diffRange(repo, sel);
    const found = checkMapNodes(spec, repo, {}).found;
    calls.list.length = 0;
    const out = nodePreviews(spec, repo, diff, range, found);
    expect(out.size).toBe(39);
    expect(countOf('diff')).toBeLessThanOrEqual(2); // the batch, plus q"uote.ts alone
    expect(countOf('cat-file')).toBeLessThanOrEqual(2);
    expect(countOf('ls-files')).toBeLessThanOrEqual(1);
  });
});

describe('gitFileDiffs', () => {
  const range = () => ({ args: ['HEAD'], revs: ['HEAD'], worktree: true, config: [] });

  it('splits requested paths across several calls', () => {
    for (let i = 0; i < 1001; i++) write(`d/f${i}.txt`, 'a\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'many');
    const rels = Array.from({ length: 1001 }, (_, i) => `d/f${i}.txt`);
    for (const r of rels.slice(0, 700)) write(r, 'b\n');
    calls.list.length = 0;
    const out = gitFileDiffs(repo, range(), rels, 50 * 1024 * 1024)!;
    expect(countOf('diff')).toBe(3);
    expect(rels.filter((r) => out.get(r) !== '')).toEqual(rels.slice(0, 700));
    expect(out.get('d/f5.txt')).toContain('+b');
  });

  it('gives up when a section is not a requested file', () => {
    write('d/a.txt', 'a\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'a');
    write('d/a.txt', 'b\n');
    expect(gitFileDiffs(repo, range(), ['d'], 1024 * 1024)).toBeUndefined();
  });

  it('gives up when the output is over the limit', () => {
    write('a.txt', 'a\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'a');
    write('a.txt', 'b\n');
    expect(gitFileDiffs(repo, range(), ['a.txt'], 10)).toBeUndefined();
  });
});
