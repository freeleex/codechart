import { execFileSync } from 'node:child_process';
import { gitBinary } from '../rules/git-files.js';

/** Git for the PR commands, which push and fetch; the read-only helpers in rules/ turn transports off. */
export function gitRun(cwd: string, args: string[], input?: string, env?: NodeJS.ProcessEnv): string {
  try {
    return execFileSync(gitBinary(), args, { cwd, encoding: 'utf8', input, env, stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 }).trim();
  } catch (e) {
    const lines = String((e as { stderr?: unknown }).stderr ?? '').trim().split('\n');
    const stderr = (lines.find((l) => /^\s*(?:error:|fatal:|!)/.test(l)) ?? lines[0])!.trim();
    const remote = lines.find((l) => /^remote:\s*\S/.test(l))?.trim();
    throw new Error(`git ${args[0]} failed: ${stderr || (e as Error).message}${remote && remote !== stderr ? `; ${remote}` : ''}`);
  }
}
