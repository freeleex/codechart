import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';
import { hasHiddenChars } from '../render/strip.js';

const MAX_REF = 200;

/** On Windows a bare command name is looked up in the child's cwd (the repo) first, so take `name` from an absolute PATH entry. */
export function trustedBinary(name: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): string {
  if (platform !== 'win32') return name;
  for (const raw of (env.PATH ?? env.Path ?? '').split(';')) {
    const dir = raw.replace(/^"(.*)"$/, '$1');
    if (!win32.isAbsolute(dir)) continue;
    const file = win32.join(dir, `${name}.exe`);
    if (exists(file)) return file;
  }
  throw new Error(`${name} not found on PATH`);
}

export const gitBinary = (platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv, exists?: (p: string) => boolean): string => trustedBinary('git', platform, env, exists);

let gitPath: string | undefined;

// A checkout's own .git/config (an unpacked archive, not a clone) must not make codechart run commands or go online,
// nor point core.worktree outside the repo (callers pass the repo root as cwd).
const SAFE_ARGS = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never'];

/** Git printed more than the caller's `maxBuffer`. */
export class OutputTooLarge extends Error {}

export interface GitOpts {
  config?: [string, string][];
  input?: string;
  maxBuffer?: number;
  binary?: boolean;
}

export function git(cwd: string, args: string[], opts: GitOpts & { binary: true }): Buffer;
export function git(cwd: string, args: string[], opts?: GitOpts): string;
export function git(cwd: string, args: string[], { config = [], input, maxBuffer = 256 * 1024 * 1024, binary }: GitOpts = {}): string | Buffer {
  try {
    gitPath ??= gitBinary();
    const n = Number(process.env.GIT_CONFIG_COUNT) || 0;
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_CONFIG_COUNT: String(n + config.length) };
    config.forEach(([k, v], i) => {
      env[`GIT_CONFIG_KEY_${n + i}`] = k;
      env[`GIT_CONFIG_VALUE_${n + i}`] = v;
    });
    return execFileSync(gitPath, [...SAFE_ARGS, `--work-tree=${cwd}`, ...args], {
      cwd,
      env,
      timeout: 30_000,
      ...(binary ? {} : { encoding: 'utf8' as const }),
      // -uall on big trees can exceed the 1 MiB default
      maxBuffer,
      ...(input === undefined ? { stdio: ['ignore', 'pipe', 'pipe'] as const } : { input, stdio: ['pipe', 'pipe', 'pipe'] as const }),
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOBUFS') throw new OutputTooLarge(`git output over ${maxBuffer} bytes`);
    const stderr = String((e as { stderr?: unknown }).stderr ?? '').trim().split('\n')[0];
    throw new Error(`git ${args.find((a) => !a.startsWith('-'))} failed: ${stderr || (e as Error).message}`);
  }
}

/** Blanks the clean/process commands of filter drivers the repo's own config defines (status would run them) and drops `required` so a blank command is not a failure. */
export function repoFilterOverrides(cwd: string): [string, string][] {
  const keys = new Set<string>();
  const drivers = new Set<string>();
  for (const key of repoConfigKeys(cwd).filter((k) => /^filter\./i.test(k))) {
    const m = /^(filter\..+)\.(clean|process)$/i.exec(key);
    if (m) {
      keys.add(key);
      drivers.add(m[1]!);
    }
  }
  return [...[...keys].map((k): [string, string] => [k, '']), ...[...drivers].map((d): [string, string] => [`${d}.required`, 'false'])];
}

/** Replaces (`^$` as git rejects an empty one) the function-name regexes diff drivers get from the repo's own config (a backtracking one stalls every diff). */
export function repoDiffOverrides(cwd: string): [string, string][] {
  return repoConfigKeys(cwd).filter((k) => /^diff\..+\.x?funcname$/i.test(k)).map((k): [string, string] => [k, '^$']);
}

const configKeys = new Map<string, string[]>();

/** The filter.* and diff.* keys the repo's own config (local or worktree scope) sets, read once per repo. */
function repoConfigKeys(cwd: string): string[] {
  const hit = configKeys.get(cwd);
  if (hit) return hit;
  const keys: string[] = [];
  try {
    const recs = git(cwd, ['config', '--show-scope', '--includes', '-z', '--name-only', '--get-regexp', '^(filter|diff)\\.']).split('\0');
    for (let i = 0; i + 1 < recs.length; i += 2) {
      if (recs[i] === 'local' || recs[i] === 'worktree') keys.push(recs[i + 1]!);
    }
  } catch {
    // no matching key, or not a repo
  }
  configKeys.set(cwd, keys);
  return keys;
}

/** Returns why `ref` is unsafe or malformed as a git revision argument, or undefined when it is fine. */
function refProblem(ref: string): string | undefined {
  if (ref === '') return 'is empty';
  if (ref.length > MAX_REF) return `is longer than ${MAX_REF} characters`;
  if (ref.startsWith('-')) return 'must not start with "-"';
  if (/\s/.test(ref) || hasHiddenChars(ref)) return 'must not contain spaces, control or invisible characters';
  return undefined;
}

export function checkRef(flag: string, ref: string): void {
  const problem = refProblem(ref);
  if (problem) throw new Error(`${flag} ${problem}`);
}
