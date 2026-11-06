import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkMapNodes, diffOf } from '../../src/render/check.js';
import { nodePreviews, parseDiff } from '../../src/render/preview.js';
import { diffRange, gitFiles, type GitSelection } from '../../src/rules/selection.js';
import type { Spec, SpecNode } from '../../src/spec/schema.js';
import { repoFromTemplate } from '../helpers/sandbox.js';

let tmp: string;
let repo: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();
const write = (rel: string, text: string) => writeFileSync(join(repo, rel), text);
const commit = (msg: string) => {
  git('add', '-A');
  git('commit', '-q', '-m', msg);
  return git('rev-parse', 'HEAD');
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-preview-'));
  repo = join(tmp, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  repoFromTemplate(repo);
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const summary = (...nodes: Partial<SpecNode>[]): Spec => ({
  title: 't',
  kind: 'summary',
  nodes: nodes.map((n, i) => ({ id: `n${i}`, label: `n${i}`, kind: 'file', layer: 'l', status: 'changed', ...n })),
  edges: [],
});

const previews = (spec: Spec, sel: GitSelection, cwd?: string) =>
  nodePreviews(spec, repo, diffOf(gitFiles(repo, sel, true)), diffRange(repo, sel), checkMapNodes(spec, repo, { cwd }).found, cwd);

const text = (p: ReturnType<typeof parseDiff> | undefined) => p?.lines.map((l) => (l.kind === 'hunk' ? '@@' : `${l.n}${{ add: '+', del: '-', ctx: ' ' }[l.kind]}${l.text}`));

describe('parseDiff', () => {
  it('skips headers, numbers lines from the hunk header and counts changes', () => {
    const p = parseDiff('a.ts', 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@ fn\n keep\n-old\n+new\n\\ No newline at end of file\n');
    expect(text(p)).toEqual(['@@', '1 keep', '2-old', '2+new']);
    expect(p).toMatchObject({ total: 2, rows: 4 });
  });

  it('keeps every hunk up to 1000 rows but counts every row and changed line', () => {
    const hunk = (i: number) => `@@ -${i * 10},1 +${i * 10},1 @@\n-a${i}\n+b${i}`;
    const four = parseDiff('a.ts', [1, 2, 3, 4].map(hunk).join('\n'));
    expect(four.lines.filter((l) => l.kind === 'hunk')).toHaveLength(4);
    expect(four).toMatchObject({ total: 8, rows: 12 });
    const long = parseDiff('a.ts', `@@ -0,0 +1,1500 @@\n${Array.from({ length: 1500 }, (_, i) => `+l${i}`).join('\n')}`);
    expect(long.lines).toHaveLength(1000);
    expect(long).toMatchObject({ total: 1500, rows: 1501 });
  });

  it('clips long lines and reports binary files', () => {
    expect(parseDiff('a', `@@ -0,0 +1 @@\n+${'x'.repeat(400)}`).lines[1]!.text).toBe(`${'x'.repeat(300)}…`);
    expect(parseDiff('a.png', 'diff --git a/a.png b/a.png\nBinary files /dev/null and b/a.png differ\n').note).toBe('binary file');
  });
});

describe('nodePreviews', () => {
  beforeEach(() => {
    write('src/a.ts', 'one\ntwo\nthree\n');
    write('src/gone.ts', 'bye\n');
    commit('init');
  });

  it('--git: changed, staged new, untracked new and deleted files', () => {
    write('src/a.ts', 'one\nTWO\nthree\n');
    write('src/staged.ts', 's\n');
    git('add', 'src/staged.ts');
    write('src/untracked.ts', 'u1\nu2\n');
    unlinkSync(join(repo, 'src/gone.ts'));
    const spec = summary({ path: 'src/a.ts' }, { path: 'src/staged.ts', status: 'new' }, { path: 'src/untracked.ts', status: 'new' }, { path: 'src/gone.ts', status: 'removed' });
    const p = previews(spec, { git: true });
    expect(text(p.get('n0'))).toEqual(['@@', '1 one', '2-two', '2+TWO', '3 three']);
    expect(text(p.get('n1'))).toEqual(['@@', '1+s']);
    expect(text(p.get('n2'))).toEqual(['@@', '1+u1', '2+u2']);
    expect(text(p.get('n3'))).toEqual(['@@', '1-bye']);
  });

  it('--commit, --since and --since with --git compare the same range as the check', () => {
    const base = git('rev-parse', 'HEAD');
    write('src/a.ts', 'one\ntwo\nthree\nfour\n');
    const sha = commit('four');
    write('src/a.ts', 'one\ntwo\nthree\nfour\nfive\n');
    const spec = summary({ path: 'src/a.ts' });
    expect(text(previews(spec, { commit: sha }).get('n0'))).toContain('4+four');
    const since = text(previews(spec, { since: base }).get('n0'));
    expect(since).toContain('4+four');
    expect(since).not.toContain('5+five');
    expect(text(previews(spec, { since: base, git: true }).get('n0'))).toEqual(expect.arrayContaining(['4+four', '5+five']));
  });

  it('a root commit diffs against the empty tree', () => {
    const root = git('rev-list', '--max-parents=0', 'HEAD');
    expect(text(previews(summary({ path: 'src/a.ts', status: 'new' }), { commit: root }).get('n0'))).toEqual(['@@', '1+one', '2+two', '3+three']);
  });

  it('no preview for context nodes, plans, folders or files outside the diff', () => {
    write('src/a.ts', 'x\n');
    const sel = { git: true };
    const p = previews(summary({ path: 'src/a.ts', status: 'context' }, { path: 'src' }, { path: 'src/gone.ts' }), sel);
    expect(p.size).toBe(0);
    expect(nodePreviews({ ...summary({ path: 'src/a.ts' }), kind: 'plan' }, repo, diffOf(['src/a.ts']), diffRange(repo, sel), new Map()).size).toBe(0);
  });

  it('from a subfolder, the file the check found wins over a changed namesake', () => {
    write('a.ts', 'root\n');
    commit('root a');
    write('src/a.ts', 'one\nTWO\nthree\n');
    const spec = summary({ path: 'a.ts' }, { path: 'gone.ts', status: 'removed' });
    unlinkSync(join(repo, 'src/gone.ts'));
    const p = previews(spec, { git: true }, join(repo, 'src'));
    expect(p.has('n0')).toBe(false);
    expect(text(p.get('n1'))).toEqual(['@@', '1-bye']);
  });

  it('nodes naming the same file share one preview', () => {
    write('src/a.ts', 'x\n');
    const p = previews(summary({ path: 'src/a.ts' }, { path: 'src/a.ts' }), { git: true });
    expect(p.get('n0')).toBeDefined();
    expect(p.get('n1')).toBe(p.get('n0'));
  });

  it('a file over 5 MB is not diffed; an untracked binary says so', () => {
    write('src/big.ts', 'x'.repeat(100).concat('\n').repeat(60_000));
    git('add', 'src/big.ts');
    writeFileSync(join(repo, 'src/img.bin'), Buffer.from([0, 1, 2]));
    const p = previews(summary({ path: 'src/big.ts', status: 'new' }, { path: 'src/img.bin', status: 'new' }), { git: true });
    expect(p.get('n0')).toMatchObject({ note: 'diff is too large (over 5 MB)', lines: [] });
    expect(p.get('n1')).toMatchObject({ note: 'binary file', lines: [] });
  });
});

describe('nodePreviews before the first commit', () => {
  it('diffs staged files against the empty tree', () => {
    write('src/a.ts', 'first\n');
    git('add', '.');
    expect(text(previews(summary({ path: 'src/a.ts', status: 'new' }), { git: true }).get('n0'))).toEqual(['@@', '1+first']);
  });
});

describe('nodePreviews runs no repo commands', () => {
  it('ignores textconv, external diff and clean filters from the checkout config', () => {
    const marker = join(tmp, 'pwned');
    const hook = join(tmp, 'hook.sh');
    writeFileSync(hook, `#!/bin/sh\ntouch ${marker}\ncat\n`, { mode: 0o755 });
    write('.gitattributes', '*.ts diff=evil filter=evil\n');
    write('src/a.ts', 'a\n');
    commit('init');
    git('config', 'diff.evil.textconv', hook);
    git('config', 'diff.evil.command', hook);
    git('config', 'diff.external', hook);
    git('config', 'filter.evil.clean', hook);
    write('src/a.ts', 'b\n');
    const p = previews(summary({ path: 'src/a.ts' }), { git: true });
    expect(text(p.get('n0'))).toEqual(['@@', '1-a', '1+b']);
    expect(existsSync(marker)).toBe(false);
  });
});

describe('nodePreviews skips generated files', () => {
  const NOTE = 'generated file, not shown';

  it('lockfiles, minified bundles and dist/ get a note instead of hunks', () => {
    const names = ['package-lock.json', 'sub/yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'go.sum', 'src/app.min.js', 'src/app.min.css', 'dist/out.js'];
    mkdirSync(join(repo, 'sub'), { recursive: true });
    mkdirSync(join(repo, 'dist'), { recursive: true });
    for (const n of names) write(n, 'old\n');
    commit('lock');
    for (const n of names) write(n, 'new\n');
    const p = previews(summary(...names.map((path) => ({ path }))), { git: true });
    for (const i of names.keys()) expect(p.get(`n${i}`), names[i]).toMatchObject({ note: NOTE, lines: [], total: 0 });
  });

  it('files marked linguist-generated are skipped; -linguist-generated opts a lockfile back in', () => {
    write('.gitattributes', '*.pb.ts linguist-generated\nyarn.lock -linguist-generated\n');
    write('src/x.pb.ts', 'a\n');
    write('yarn.lock', 'a\n');
    commit('attrs');
    write('src/x.pb.ts', 'b\n');
    write('yarn.lock', 'b\n');
    const p = previews(summary({ path: 'src/x.pb.ts' }, { path: 'yarn.lock' }), { git: true });
    expect(p.get('n0')).toMatchObject({ note: NOTE, lines: [] });
    expect(text(p.get('n1'))).toEqual(['@@', '1-a', '1+b']);
  });

  it('an untracked lockfile is skipped too and costs no budget', () => {
    write('package-lock.json', 'x\n'.repeat(1000));
    expect(previews(summary({ path: 'package-lock.json', status: 'new' }), { git: true }).get('n0')).toMatchObject({ note: NOTE, lines: [] });
  });
});
