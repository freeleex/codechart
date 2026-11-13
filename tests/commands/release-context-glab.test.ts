import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// glab 1.109.0's output for a missing MR, even with NO_COLOR=1 CI=true
const GLAB_404 = '\n ERROR  \n\n  Failed to get merge request 9: 404 Not Found.\n';

vi.mock('node:child_process', async (orig) => {
  const m = await orig<typeof import('node:child_process')>();
  return {
    ...m,
    execFileSync: ((file: string, ...rest: unknown[]) => {
      if (file === 'glab') throw Object.assign(new Error('exit 1'), { status: 1, stderr: GLAB_404 });
      return (m.execFileSync as (...a: unknown[]) => unknown)(file, ...rest);
    }) as typeof m.execFileSync,
  };
});

const { git, makeSandbox, removeSandbox, runCli } = await import('../helpers/sandbox.js');

describe.runIf(process.platform !== 'win32')('codechart release-context with real glab output', () => {
  let sb: ReturnType<typeof makeSandbox>;
  beforeEach(() => {
    sb = makeSandbox('release-context-glab', { git: 'init' });
    git(sb.repo, 'commit', '-q', '--allow-empty', '-m', 'base');
    git(sb.repo, 'tag', 'v1.0.0');
    git(sb.repo, 'remote', 'add', 'origin', 'https://gitlab.example.com/g/p.git');
    for (const n of [9, 10]) {
      writeFileSync(join(sb.repo, `${n}.txt`), 'x');
      git(sb.repo, 'add', '-A');
      git(sb.repo, 'commit', '-q', '-m', `change ${n}`, '-m', `See merge request g/p!${n}`);
    }
  });
  afterEach(() => removeSandbox(sb.tmp));

  it('reads past the ERROR banner: a missing MR is skipped with its reason', async () => {
    const r = await runCli({ cwd: sb.repo, home: sb.home, tool: undefined }, ['release-context']);
    expect((JSON.parse(r.out) as { notes?: string[] }).notes).toEqual(['PR descriptions were not read for #9, #10: glab failed: Failed to get merge request 9: 404 Not Found.']);
  });
});
