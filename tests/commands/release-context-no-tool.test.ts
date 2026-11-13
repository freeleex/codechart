import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const looked: string[] = [];

vi.mock('../../src/rules/git-run.js', async (orig) => ({
  ...(await orig<typeof import('../../src/rules/git-run.js')>()),
  trustedBinary: (name: string) => {
    looked.push(name);
    throw new Error(`${name} not found on PATH`);
  },
}));

const { git, makeSandbox, removeSandbox, runCli } = await import('../helpers/sandbox.js');

describe('codechart release-context without gh on PATH', () => {
  let sb: ReturnType<typeof makeSandbox>;
  beforeEach(() => {
    sb = makeSandbox('release-context-no-tool', { git: 'init' });
    git(sb.repo, 'commit', '-q', '--allow-empty', '-m', 'base');
    git(sb.repo, 'tag', 'v1.0.0');
    git(sb.repo, 'remote', 'add', 'origin', 'git@github.com:o/r.git');
    for (const n of [7, 8, 9]) {
      writeFileSync(join(sb.repo, `${n}.txt`), 'x');
      git(sb.repo, 'add', '-A');
      git(sb.repo, 'commit', '-q', '-m', `change (#${n})`);
    }
    looked.length = 0;
  });
  afterEach(() => removeSandbox(sb.tmp));

  it('stops at the first PR with one note, as when gh is not installed', async () => {
    const r = await runCli({ cwd: sb.repo, home: sb.home, tool: undefined }, ['release-context']);
    expect(looked).toEqual(['gh']);
    expect((JSON.parse(r.out) as { notes?: string[] }).notes).toEqual(['PR descriptions were not read: gh is not installed.']);
  });
});
