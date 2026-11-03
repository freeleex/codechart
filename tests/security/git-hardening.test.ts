import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitFileDiff } from '../../src/rules/git-files.js';

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

