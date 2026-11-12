/* eslint-disable max-lines -- ratchet: grew past 250 in #24 (batched preview reads) before the gate; split those out when next touched */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { join, win32 } from 'node:path';
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

interface GitOpts {
  config?: [string, string][];
  input?: string;
  maxBuffer?: number;
  binary?: boolean;
}

function git(cwd: string, args: string[], opts: GitOpts & { binary: true }): Buffer;
function git(cwd: string, args: string[], opts?: GitOpts): string;
function git(cwd: string, args: string[], { config = [], input, maxBuffer = 256 * 1024 * 1024, binary }: GitOpts = {}): string | Buffer {
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

const nulList = (out: string) => out.split('\0').filter(Boolean);

/** Git's change to a file: added, modified, deleted, or moved (the status is the new path's). */
export type ChangeStatus = 'A' | 'M' | 'D' | 'R';

/** One changed file, repo-relative with `/`. */
export interface FileChange {
  path: string;
  status: ChangeStatus;
}

const porcelainStatus = (x: string, y: string): ChangeStatus => {
  if (x === '?') return 'A';
  if (x === 'D' || y === 'D') return 'D';
  if (x === 'R' || y === 'R') return 'R';
  return x === 'A' || y === 'A' || x === 'C' ? 'A' : 'M';
};

/** `--name-status -z` records, where a rename or copy adds the old path before the new one. */
function parseNameStatus(out: string): FileChange[] {
  const parts = out.split('\0');
  const changes: FileChange[] = [];
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++];
    if (!code) continue;
    const letter = code[0]!.toUpperCase();
    if (letter === 'R' || letter === 'C') {
      const from = parts[i++];
      const to = parts[i++];
      // A rename's old path is gone, so it reads as deleted; a copy leaves it in place.
      if (from && letter === 'R') changes.push({ path: from, status: 'D' });
      if (to) changes.push({ path: to, status: letter === 'R' ? 'R' : 'A' });
      continue;
    }
    const path = parts[i++];
    if (path) changes.push({ path, status: letter === 'A' || letter === 'D' || letter === 'R' ? letter : letter === 'C' ? 'A' : 'M' });
  }
  return changes;
}

/** Each changed file in the working tree with git's status; `renameSources` adds where a rename moved from, as deleted. */
export function gitChangedChanges(cwd: string, renameSources = false): FileChange[] {
  const records = git(cwd, ['status', '--porcelain=v1', '-z', '-uall', '--ignore-submodules=dirty'], { config: repoFilterOverrides(cwd) }).split('\0');
  const changes: FileChange[] = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (!rec || rec.length < 4) continue;
    const [x, y] = [rec[0]!, rec[1]!];
    changes.push({ path: rec.slice(3), status: porcelainStatus(x, y) });
    // rename/copy records are followed by the original path
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      i++;
      // The old path of a rename is gone, so it reads as deleted; a copy leaves it in place.
      if (records[i] && renameSources && (x === 'R' || y === 'R')) changes.push({ path: records[i]!, status: 'D' });
    }
  }
  return changes;
}

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

/**
 * `renameSources`: also list the path a rename moved from (gone from the tree, so changed too).
 * --ignore-submodules=dirty: checking a nested repo's files runs that repo's own filters, which the overrides do not reach.
 */
export function gitChangedFiles(cwd: string, renameSources = false): string[] {
  return gitChangedChanges(cwd, renameSources).map((c) => c.path);
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

/** A commit's first parent, or undefined for a root commit. */
export function gitParent(cwd: string, sha: string): string | undefined {
  return git(cwd, ['rev-list', '--parents', '-n', '1', sha, '--']).trim().split(' ')[1];
}

/** The empty tree's id in this repo's hash format. */
export function gitEmptyTree(cwd: string): string {
  return git(cwd, ['hash-object', '-t', 'tree', '--stdin'], { input: '' }).trim();
}

/** Where `head` forked from `base`. */
export function gitMergeBase(cwd: string, base: string, head = 'HEAD'): string {
  checkRef('--since', base);
  return git(cwd, ['merge-base', base, head]).trim();
}

/** What a file diff compares: `args` are the revisions; `revs`: the commits on its sides; `worktree`: the working tree is the new side. */
export interface DiffRange {
  args: string[];
  revs: string[];
  worktree: boolean;
  config: [string, string][];
}

/** Size of each `rev:path` object; undefined where it is not a blob. Paths must not hold a newline. */
export function gitBlobSizes(cwd: string, specs: string[]): (number | undefined)[] {
  if (!specs.length) return [];
  const out = git(cwd, ['cat-file', '--batch-check'], { input: specs.map((s) => `${s}\n`).join('') }).split('\n');
  return specs.map((_, i) => {
    const m = /^[0-9a-f]+ blob (\d+)$/.exec(out[i] ?? '');
    return m ? Number(m[1]) : undefined;
  });
}

/** The content of each `rev:path` blob, unfiltered; `sizes` are from `gitBlobSizes`, which parses the one-call output. */
export function gitBlobs(cwd: string, specs: string[], sizes: number[]): string[] {
  if (!specs.length) return [];
  const out = git(cwd, ['cat-file', '--batch'], { input: specs.map((s) => `${s}\n`).join(''), binary: true });
  const texts: string[] = [];
  let at = 0;
  for (const size of sizes) {
    const eol = out.indexOf(10, at);
    if (eol < 0 || !/^[0-9a-f]+ blob \d+$/.test(out.toString('latin1', at, eol))) throw new Error('git cat-file --batch: unexpected output');
    texts.push(out.toString('utf8', eol + 1, eol + 1 + size));
    at = eol + 1 + size + 1;
  }
  return texts;
}

/** `rel`'s content at `rev`, unfiltered. */
export function gitBlob(cwd: string, rev: string, rel: string): string {
  return git(cwd, ['cat-file', 'blob', `${rev}:${rel}`]);
}

// --src-prefix/--dst-prefix: a user's diff.noprefix would change the `diff --git` lines the batch splits on.
const diffArgs = (range: DiffRange, paths: string[]) => [
  '--literal-pathspecs', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--submodule=short', '--ignore-submodules=dirty',
  '--src-prefix=a/', '--dst-prefix=b/', '-U3', ...range.args, '--', ...paths,
];

/**
 * One file's unified diff over `range` (`rel` is repo-relative with `/`).
 * --no-ext-diff/--no-textconv: the repo's config must not make the diff run its commands.
 * bigFileThreshold: xdiff loads both sides in memory, so a huge compressible blob must come out as binary.
 * Throws `OutputTooLarge` past `maxBytes`.
 */
export function gitFileDiff(cwd: string, range: DiffRange, rel: string, maxBytes: number): string {
  return git(cwd, diffArgs(range, [rel]), { config: [['core.bigFileThreshold', '5m'], ...range.config], maxBuffer: maxBytes });
}

/** Each of `rels` with its `linguist-generated` attribute: true when set, false when unset or `false`, absent when unspecified. Paths must not hold a newline. */
export function gitGeneratedAttr(cwd: string, rels: string[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  if (!rels.length) return out;
  const parts = git(cwd, ['check-attr', '-z', '--stdin', 'linguist-generated'], { input: rels.map((r) => `${r}\0`).join('') }).split('\0');
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const value = parts[i + 2]!;
    if (value === 'unspecified') continue;
    out.set(parts[i]!, value !== 'unset' && value !== 'false');
  }
  return out;
}

const CHUNK_PATHS = 500;
const CHUNK_CHARS = 20_000;

function chunks(paths: string[]): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let chars = 0;
  for (const p of paths) {
    if (cur.length && (cur.length >= CHUNK_PATHS || chars + p.length > CHUNK_CHARS)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(p);
    chars += p.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** A name git prints bare in `diff --git` headers; others (quotes, backslash, control characters) it escapes. */
export const plainDiffName = (rel: string) => !/[\x00-\x1f\x7f"\\]/.test(rel);

/**
 * `gitFileDiff` for many files in few calls: the diff of each of `rels` (all `plainDiffName`), '' where unchanged.
 * undefined when the output of all calls together is over `maxBytes` or a section can't be matched to a requested file; the caller then diffs file by file.
 */
export function gitFileDiffs(cwd: string, range: DiffRange, rels: string[], maxBytes: number): Map<string, string> | undefined {
  const out = new Map<string, string>(rels.map((r) => [r, '']));
  const wanted = new Set(rels);
  let left = maxBytes;
  try {
    for (const group of chunks(rels)) {
      if (left <= 0) return undefined;
      const text = git(cwd, diffArgs(range, group), { config: [['core.bigFileThreshold', '5m'], ['core.quotePath', 'false'], ...range.config], maxBuffer: left });
      left -= Buffer.byteLength(text);
      const starts = [...text.matchAll(/^diff --git /gm)].map((m) => m.index);
      for (const [i, start] of starts.entries()) {
        const end = starts[i + 1] ?? text.length;
        const eol = text.indexOf('\n', start);
        const head = text.slice(start + 'diff --git '.length, eol < 0 ? end : eol);
        // --no-renames: both sides name the same path, so `a/P b/P` splits unambiguously
        const len = (head.length - 'a/ b/'.length) / 2;
        const rel = head.slice('a/'.length, 'a/'.length + len);
        if (!Number.isInteger(len) || head !== `a/${rel} b/${rel}` || !wanted.has(rel)) return undefined;
        out.set(rel, (out.get(rel) ?? '') + text.slice(start, end));
      }
    }
  } catch (e) {
    if (e instanceof OutputTooLarge) return undefined;
    throw e;
  }
  return out;
}

/** Those of `rels` that are untracked and not ignored. */
export function gitUntracked(cwd: string, rels: string[]): Set<string> {
  const found = new Set<string>();
  const wanted = new Set(rels);
  for (const group of chunks(rels)) {
    for (const f of git(cwd, ['--literal-pathspecs', 'ls-files', '-z', '--others', '--exclude-standard', '--', ...group]).split('\0')) {
      if (wanted.has(f)) found.add(f);
    }
  }
  return found;
}

// A partial clone has no blobs to compare, so rename detection fails there: fall back to added and deleted.
const withRenames = (cwd: string, args: string[], paths = true): FileChange[] => {
  const run = (renames: string) => git(cwd, [...args, renames, ...(paths ? ['--'] : [])]);
  try {
    return parseNameStatus(run('--find-renames'));
  } catch {
    return parseNameStatus(run('--no-renames'));
  }
};

/** What one commit changed, with statuses; a merge is compared with its first parent. */
export function gitCommitChanges(cwd: string, ref: string): FileChange[] {
  const sha = resolveCommit(cwd, '--commit', ref);
  const parent = gitParent(cwd, sha);
  if (!parent) return withRenames(cwd, ['diff-tree', '-r', '--root', '--no-commit-id', '--name-status', '-z', sha], false);
  return withRenames(cwd, ['diff', '--name-status', '-z', parent, sha]);
}

/** What changed on `head` since it forked from `base` (`base...head`), with statuses. */
export function gitSinceChanges(cwd: string, base: string, head = 'HEAD'): FileChange[] {
  checkRef('--since', base);
  checkRef('--head', head);
  return withRenames(cwd, ['diff', '--name-status', '-z', `${base}...${head}`]);
}

/** Files one commit changed; a merge is compared with its first parent. */
export const gitCommitFiles = (cwd: string, ref: string): string[] => gitCommitChanges(cwd, ref).map((c) => c.path);

/** Files changed on `head` since it forked from `base` (`base...head`). */
export const gitSinceFiles = (cwd: string, base: string, head = 'HEAD'): string[] => gitSinceChanges(cwd, base, head).map((c) => c.path);

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

/** HEAD's sha, or undefined before the first commit. */
export function gitHead(cwd: string): string | undefined {
  try {
    return git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** The checked-out branch; `(detached)` on a bare commit, '' outside a repo or before the first commit on none. */
export function gitBranch(cwd: string): string {
  try {
    return git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']).trim();
  } catch {
    return gitHead(cwd) ? '(detached)' : '';
  }
}

/** Whether `base` (a full sha) is `of` or one of its ancestors; `of` is HEAD or a full sha. */
export function gitIsAncestor(cwd: string, base: string, of = 'HEAD'): boolean {
  const sha = /^[0-9a-f]{40,64}$/;
  if (!sha.test(base) || (of !== 'HEAD' && !sha.test(of))) return false;
  try {
    git(cwd, ['merge-base', '--is-ancestor', base, of]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Each uncommitted file with its content hash (`deleted` when gone), to tell later which ones changed.
 * `--no-filters`: hashing must not run the repo's clean filters.
 */
export function gitDirtyHashes(cwd: string, max = Infinity): Record<string, string> | undefined {
  const files = gitChangedFiles(cwd);
  if (files.length > max) return undefined;
  const out: Record<string, string> = {};
  // A dirty submodule is listed as a folder; hash-object takes files only.
  // hash-object --stdin-paths C-unquotes a line starting with `"`, so such names are not hashed
  const present = files.filter((f) => !f.includes('\n') && !f.startsWith('"') && lstatSync(join(cwd, f), { throwIfNoEntry: false })?.isFile() === true);
  const hashes = present.length
    ? git(cwd, ['hash-object', '--no-filters', '--stdin-paths'], { input: present.join('\n') }).trim().split('\n')
    : [];
  for (const f of files) out[f] = existsSync(join(cwd, f)) ? 'present' : 'deleted';
  present.forEach((f, i) => (out[f] = hashes[i] ?? ''));
  return out;
}

/** Files changed between two commits. */
export function gitDiffFiles(cwd: string, from: string, to: string): string[] {
  return nulList(git(cwd, ['diff', '--no-renames', '--name-only', '-z', from, to, '--']));
}

/** The newest tag matching `pattern` reachable from commit `sha`; undefined when there is none. */
export function gitLatestTag(cwd: string, sha: string, pattern: string): string | undefined {
  try {
    return git(cwd, ['describe', '--tags', '--abbrev=0', '--match', pattern, sha]).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** One commit of `gitFirstParentLog`. */
export interface LogEntry {
  sha: string;
  short: string;
  date: string;
  subject: string;
  body: string;
}

/** The first-parent commits in `since..head` (full shas), oldest first. */
export function gitFirstParentLog(cwd: string, since: string, head: string): LogEntry[] {
  const out = git(cwd, ['log', '--first-parent', '--reverse', '--no-color', '--no-show-signature', '--format=%H%x1f%h%x1f%cI%x1f%s%x1f%b%x1e', `${since}..${head}`, '--']);
  return out
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [sha = '', short = '', date = '', subject = '', body = ''] = r.split('\x1f');
      return { sha, short, date, subject, body: body.trim() };
    });
}
