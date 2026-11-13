import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { repoDiffOverrides, repoFilterOverrides } from '../../src/rules/git-run.js';
import { diffRange, gitFiles } from '../../src/rules/selection.js';

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

let tmp: string;
let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-cfg-'));
  repo = join(tmp, 'repo');
  mkdirSync(repo);
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  git('config', 'filter.lfs.clean', 'evil');
  git('config', 'diff.evil.xfuncname', '(a+)+$');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

it('reads the repo config once for the file list and the diff range', () => {
  calls.list.length = 0;
  gitFiles(repo, { git: true }, true);
  const range = diffRange(repo, { git: true });
  diffRange(repo, { git: true });
  expect(calls.list.filter((a) => a.includes('config'))).toHaveLength(1);
  expect(range.config).toEqual(
    expect.arrayContaining([['diff.evil.xfuncname', '^$'], ['filter.lfs.clean', ''], ['filter.lfs.required', 'false']]),
  );
  expect(repoFilterOverrides(repo)).toHaveLength(2);
  expect(repoDiffOverrides(repo)).toEqual([['diff.evil.xfuncname', '^$']]);
});
