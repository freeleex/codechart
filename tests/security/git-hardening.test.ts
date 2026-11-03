import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitFileDiff, repoDiffOverrides } from '../../src/rules/git-files.js';
import { diffRange } from '../../src/rules/selection.js';

let tmp: string;
let repo: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();
const commit = (msg: string) => {
  git('add', '-A');
  git('commit', '-q', '-m', msg);
  return git('rev-parse', 'HEAD');
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-gith-'));
  repo = join(tmp, 'repo');
  mkdirSync(repo);
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  git('config', 'commit.gpgsign', 'false');
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('S-30 big files in the preview diff', () => {
  it('come out as binary instead of being diffed in memory', () => {
    writeFileSync(join(repo, 'big.txt'), 'a\n'.repeat(3_000_000));
    const first = commit('one');
    writeFileSync(join(repo, 'big.txt'), 'b\n'.repeat(3_000_000));
    const second = commit('two');
    const t = Date.now();
    const text = gitFileDiff(repo, { args: [first, second], worktree: false, config: [] }, 'big.txt', 100 * 1024 * 1024);
    expect(text).toMatch(/^Binary files .* differ$/m);
    expect(Date.now() - t).toBeLessThan(5000);
  });
});


describe('S-31 core.worktree in the checkout config', () => {
  it('does not make diffs read files outside the repo', () => {
    mkdirSync(join(repo, '.ssh'));
    writeFileSync(join(repo, '.ssh', 'id_ed25519'), 'placeholder\n');
    commit('one');
    const elsewhere = join(tmp, 'home');
    mkdirSync(join(elsewhere, '.ssh'), { recursive: true });
    writeFileSync(join(elsewhere, '.ssh', 'id_ed25519'), 'TOP-SECRET-KEY\n');
    git('config', 'core.worktree', elsewhere);
    const text = gitFileDiff(repo, { args: ['HEAD'], worktree: true, config: [] }, '.ssh/id_ed25519', 1024 * 1024);
    expect(text).not.toContain('TOP-SECRET-KEY');
  });
});


describe('S-33 diff driver function-name patterns', () => {
  it('are blanked so a repo cannot stall the preview diff', () => {
    git('config', 'diff.evil.xfuncname', '^(MARKER.*)$');
    git('config', 'diff.evil.funcname', 'MARKER');
    git('config', 'user.name', 'T');
    writeFileSync(join(repo, '.gitattributes'), '* diff=evil\n');
    writeFileSync(join(repo, 'a.txt'), `MARKER top\n${'x\n'.repeat(10)}old\n`);
    commit('one');
    writeFileSync(join(repo, 'a.txt'), `MARKER top\n${'x\n'.repeat(10)}new\n`);

    expect(repoDiffOverrides(repo)).toEqual(expect.arrayContaining([['diff.evil.xfuncname', '^$'], ['diff.evil.funcname', '^$']]));
    const range = diffRange(repo, { git: true });
    const text = gitFileDiff(repo, range, 'a.txt', 1024 * 1024);
    expect(text).toContain('@@');
    expect(text).not.toContain('MARKER');
    expect(gitFileDiff(repo, { ...range, config: [] }, 'a.txt', 1024 * 1024)).toContain('MARKER');
  });
});

