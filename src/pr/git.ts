import { execFileSync } from 'node:child_process';
import { gitBinary } from '../rules/git-files.js';

/** Git for the PR commands, which push and fetch; the read-only helpers in rules/ turn transports off. */
export function gitRun(cwd: string, args: string[], input?: string, env?: NodeJS.ProcessEnv): string {
  try {
    return execFileSync(gitBinary(), args, { cwd, encoding: 'utf8', input, env, stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 }).trim();
  } catch (e) {
    const stderr = String((e as { stderr?: unknown }).stderr ?? '').trim().split('\n')[0];
    throw new Error(`git ${args[0]} failed: ${stderr || (e as Error).message}`);
  }
}
