import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git, makeSandbox, removeSandbox, runCli, type Sandbox } from '../helpers/sandbox.js';

let sb: Sandbox;

beforeEach(() => {
  sb = makeSandbox('hook-edges', { git: 'init' });
  writeFileSync(join(sb.repo, 'a.ts'), 'a\n');
  git(sb.repo, 'add', '.');
  git(sb.repo, 'commit', '-q', '-m', 'init');
});
afterEach(() => removeSandbox(sb.tmp));

const input = (extra: Record<string, unknown> = {}) => JSON.stringify({ session_id: 's1', cwd: sb.repo, ...extra });
const run = (event: 'prompt' | 'stop', stdin: string) => runCli({ cwd: sb.repo, home: sb.home, stdin: async () => stdin }, ['hook', event]);

describe('codechart hook edge input', () => {
  it('input over 1 MB prints nothing, fails nothing and records nothing', async () => {
    const r = await run('prompt', input({ pad: 'x'.repeat(1024 * 1024) }));
    expect(r.out).toBe('');
    expect(r.err).toBe('');
    expect(r.code).toBeUndefined();
    expect(existsSync(join(sb.home, '.cache'))).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('a transcript path that is a FIFO does not hang or crash the hook', async () => {
    await run('prompt', input());
    for (const f of ['b.ts', 'c.ts', 'd.ts']) writeFileSync(join(sb.repo, f), 'x\n');
    const fifo = join(sb.tmp, 't.jsonl');
    execFileSync('mkfifo', [fifo]);
    const r = await run('stop', input({ transcript_path: fifo }));
    expect(r.err).toBe('');
    expect(r.code).toBeUndefined();
    expect(JSON.parse(r.out).hookSpecificOutput.additionalContext).toContain('changed 3 files');
  }, 10_000);
});
