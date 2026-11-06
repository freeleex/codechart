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
import { repoFromTemplate } from '../helpers/sandbox.js';

// Each test commits hundreds of files; the 5 s default times out when the full suite runs in parallel.
vi.setConfig({ testTimeout: 30_000 });

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
  repoFromTemplate(repo);
});
// Windows keeps a repo git just wrote hundreds of files in locked for seconds; the runner's temp dir is thrown away anyway
afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (e) {
    if (process.platform !== 'win32') throw e;
  }
});

// `>` and `"` are not allowed in Windows file names
const [ARROW, QUOTE] = process.platform === 'win32' ? ['a b/c - d.ts', "q'uote.ts"] : ['a b/c -> d.ts', 'q"uote.ts'];
const MIX = ['src/plain.ts', 'my file.ts', 'héllo/ü.ts', ARROW, QUOTE, 'src/gone.ts', 'src/binary.bin', 'src/new.ts', '.env', 'src/same.ts'];

function seedMix() {
  for (const f of ['src/plain.ts', 'my file.ts', 'héllo/ü.ts', ARROW, QUOTE, 'src/gone.ts', 'src/same.ts']) write(f, 'one\ntwo\nthree\n');
  write('src/binary.bin', Buffer.from([0, 1, 2, 3]));
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  for (const f of ['src/plain.ts', 'my file.ts', 'héllo/ü.ts', ARROW, QUOTE]) write(f, 'one\nTWO\nthree\nfour\n');
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
    for (const path of ['src/plain.ts', 'my file.ts', 'héllo/ü.ts', ARROW, QUOTE, 'src/gone.ts']) {
      const node = MIX.indexOf(path);
      expect(out.get(`n${node}`), path).toEqual(alone(path));
      expect(out.get(`n${node}`)!.total, path).toBeGreaterThan(0);
    }
    expect(out.get('n6')).toMatchObject({ note: 'binary file', lines: [] });
    expect(out.get('n7')).toMatchObject({
      path: 'src/new.ts',
      total: 2,
      rows: 3,
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

describe('the prefetch budget', () => {
  it('reads only the files whose sides fit in 25 MB, in node order', () => {
    const files = Array.from({ length: 6 }, (_, i) => `big${i}.txt`);
    for (const f of files) write(f, 'a\n'.repeat(2_000_000));
    git('add', '-A');
    git('commit', '-q', '-m', 'big');
    for (const f of files) write(f, `b\n${'a\n'.repeat(1_999_999)}`);
    const spec = specOf(files);
    const sel = { git: true };
    const diff = diffOf(gitFiles(repo, sel, true));
    const range = diffRange(repo, sel);
    const found = checkMapNodes(spec, repo, {}).found;
    calls.list.length = 0;
    const out = nodePreviews(spec, repo, diff, range, found);
    const batched = calls.list.find((a) => a.includes('diff') && a.includes('big0.txt'))!;
    expect(batched.filter((a) => a.startsWith('big'))).toEqual(files.slice(0, 3));
    expect(out.get('n0')?.lines.length).toBeGreaterThan(0);
    expect(out.get('n5')?.note).toBe('not shown: the diffs pass 25 MB together');
  });
});

describe('gitFileDiffs', () => {
  const range = () => ({ args: ['HEAD'], revs: ['HEAD'], worktree: true, config: [] });

  it('counts the limit across calls', () => {
    for (let i = 0; i < 600; i++) write(`d/f${i}.txt`, 'a\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'many');
    const rels = Array.from({ length: 600 }, (_, i) => `d/f${i}.txt`);
    for (const r of rels) write(r, `${'x'.repeat(200)}\n`);
    const one = gitFileDiffs(repo, range(), rels.slice(0, 500), 50 * 1024 * 1024)!;
    const firstChunk = [...one.values()].reduce((n, t) => n + Buffer.byteLength(t), 0);
    // the first chunk uses up the limit, so the second is refused before git runs (a killed git holds the folder on Windows)
    calls.list.length = 0;
    expect(gitFileDiffs(repo, range(), rels, firstChunk)).toBeUndefined();
    expect(countOf('diff')).toBe(1);
  });

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
