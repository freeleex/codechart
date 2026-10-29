import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';
import { hasHiddenChars } from '../render/strip.js';

const MAX_REF = 200;

/** On Windows a bare command name is looked up in the child's cwd (the repo) first, so take git from an absolute PATH entry. */
export function gitBinary(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): string {
  if (platform !== 'win32') return 'git';
  for (const raw of (env.PATH ?? env.Path ?? '').split(';')) {
    const dir = raw.replace(/^"(.*)"$/, '$1');
    if (!win32.isAbsolute(dir)) continue;
    const file = win32.join(dir, 'git.exe');
    if (exists(file)) return file;
  }
  throw new Error('git not found on PATH');
}

let gitPath: string | undefined;

// A checkout's own .git/config (an unpacked archive, not a clone) must not make codechart run commands or go online.
const SAFE_ARGS = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never'];

function git(cwd: string, args: string[], config: [string, string][] = []): string {
  try {
    gitPath ??= gitBinary();
    const n = Number(process.env.GIT_CONFIG_COUNT) || 0;
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_CONFIG_COUNT: String(n + config.length) };
    config.forEach(([k, v], i) => {
      env[`GIT_CONFIG_KEY_${n + i}`] = k;
      env[`GIT_CONFIG_VALUE_${n + i}`] = v;
    });
    return execFileSync(gitPath, [...SAFE_ARGS, ...args], {
      cwd,
      env,
      timeout: 30_000,
      encoding: 'utf8',
      // -uall on big trees can exceed the 1 MiB default
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const stderr = String((e as { stderr?: unknown }).stderr ?? '').trim().split('\n')[0];
    throw new Error(`git ${args.find((a) => !a.startsWith('-'))} failed: ${stderr || (e as Error).message}`);
  }
}

/** Blanks the clean/process commands of filter drivers the repo's own config defines (status would run them) and drops `required` so a blank command is not a failure. */
function repoFilterOverrides(cwd: string): [string, string][] {
  let out: string;
  try {
    out = git(cwd, ['config', '--show-scope', '--includes', '-z', '--name-only', '--get-regexp', '^filter\\.']);
  } catch {
    return [];
  }
  const keys = new Set<string>();
  const drivers = new Set<string>();
  const recs = out.split('\0');
  for (let i = 0; i + 1 < recs.length; i += 2) {
    const [scope, key] = [recs[i], recs[i + 1]!];
    const m = /^(filter\..+)\.(clean|process)$/i.exec(key);
    if ((scope === 'local' || scope === 'worktree') && m) {
      keys.add(key);
      drivers.add(m[1]!);
    }
  }
  return [...[...keys].map((k): [string, string] => [k, '']), ...[...drivers].map((d): [string, string] => [`${d}.required`, 'false'])];
}

const nulList = (out: string) => out.split('\0').filter(Boolean);

/** Returns why `ref` is unsafe or malformed as a git revision argument, or undefined when it is fine. */
function refProblem(ref: string): string | undefined {
  if (ref === '') return 'is empty';
  if (ref.length > MAX_REF) return `is longer than ${MAX_REF} characters`;
  if (ref.startsWith('-')) return 'must not start with "-"';
  if (/\s/.test(ref) || hasHiddenChars(ref)) return 'must not contain spaces, control or invisible characters';
  return undefined;
}

function checkRef(flag: string, ref: string): void {
  const problem = refProblem(ref);
  if (problem) throw new Error(`${flag} ${problem}`);
}

export function gitChangedFiles(cwd: string): string[] {
  const records = git(cwd, ['status', '--porcelain=v1', '-z', '-uall'], repoFilterOverrides(cwd)).split('\0');
  const files: string[] = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (!rec || rec.length < 4) continue;
    files.push(rec.slice(3));
    // rename/copy records are followed by the original path
    if (rec[0] === 'R' || rec[0] === 'C' || rec[1] === 'R' || rec[1] === 'C') i++;
  }
  return files;
}

/** Validates `ref` and resolves it to a commit sha. */
export function resolveCommit(cwd: string, flag: string, ref: string): string {
  checkRef(flag, ref);
  try {
    return git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim();
  } catch {
    throw new Error(`${flag} ${ref} is not a commit`);
  }
}

/** Files one commit changed; a merge is compared with its first parent. */
export function gitCommitFiles(cwd: string, ref: string): string[] {
  const sha = resolveCommit(cwd, '--commit', ref);
  const parent = git(cwd, ['rev-list', '--parents', '-n', '1', sha, '--']).trim().split(' ')[1];
  if (!parent) return nulList(git(cwd, ['diff-tree', '-r', '--root', '--no-commit-id', '--name-only', '-z', sha]));
  return nulList(git(cwd, ['diff', '--no-renames', '--name-only', '-z', parent, sha, '--']));
}

/** Files changed on `head` since it forked from `base` (`base...head`). */
export function gitSinceFiles(cwd: string, base: string, head = 'HEAD'): string[] {
  checkRef('--since', base);
  checkRef('--head', head);
  return nulList(git(cwd, ['diff', '--no-renames', '--name-only', '-z', `${base}...${head}`, '--']));
}

/** Tracked and untracked (not ignored) files, or the files of commit `sha`. */
export function gitListFiles(cwd: string, sha?: string): string[] {
  return nulList(
    sha
      ? git(cwd, ['ls-tree', '-r', '-z', '--name-only', '--full-tree', sha])
      : git(cwd, ['ls-files', '-z', '--cached', '--full-name']),
  );
}

/**
 * A file's text at commit `sha` (`rel` is repo-relative, already checked to stay in the repo and out of .git).
 * `null`: no such file at that commit. Symlinks and directories are refused, like on disk.
 */
export function gitFileAt(cwd: string, sha: string, rel: string, maxBytes: number): string | { error: string } | null {
  const entry = git(cwd, ['--literal-pathspecs', 'ls-tree', '-z', '--full-tree', sha, '--', rel]).split('\0')[0];
  if (!entry) return null;
  const [meta, path] = entry.split('\t');
  const [mode, type, oid] = meta!.split(' ');
  if (path !== rel) return null;
  if (type !== 'blob' || mode === '120000') return { error: `${rel} is not a regular file at ${sha.slice(0, 12)}` };
  if (Number(git(cwd, ['cat-file', '-s', oid!]).trim()) > maxBytes) return { error: `${rel} is too large (over 5 MB)` };
  return git(cwd, ['cat-file', 'blob', oid!]);
}
