import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram, runProgram } from '../../src/program.js';
import { makeTempDir, removeTempDir } from '../helpers/sandbox.js';

let tmp: string;
beforeEach(() => {
  tmp = makeTempDir('prune');
});
afterEach(() => removeTempDir(tmp));

describe('S-39 hook prune', () => {
  it('a directory in the turns cache does not stop the snapshot being written', async () => {
    const repo = join(tmp, 'repo');
    const home = join(tmp, 'home');
    mkdirSync(repo);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    const turns = join(home, '.cache', 'codechart', 'turns');
    mkdirSync(join(turns, 'subdir'), { recursive: true });
    const program = buildProgram({
      cwd: repo, home, env: {}, stdout: () => {}, stderr: () => {}, isTTY: false,
      stdin: async () => JSON.stringify({ session_id: 's1', cwd: repo }),
      now: () => new Date(Date.now() + 30 * 86_400_000),
    });
    await runProgram(program, ['hook', 'prompt'], 'user');
    expect(existsSync(join(turns, 's1.json'))).toBe(true);
    expect(existsSync(join(turns, 'subdir'))).toBe(true);
  });
});
