import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { checkRef, git, repoFilterOverrides, type GitOpts } from './git-run.js';

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
  const records = git(cwd, ['status', '--porcelain=v1', '-z', '-uall', '--renames', '--ignore-submodules=dirty'], { config: repoFilterOverrides(cwd) }).split('\0');
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

// A partial clone has no blobs to compare, so rename detection fails there: fall back to added and deleted.
const withRenames = (cwd: string, args: string[], paths = true, opts: GitOpts = {}): FileChange[] => {
  const run = (renames: string) => git(cwd, [...args, renames, ...(paths ? ['--'] : [])], opts);
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

/**
 * What changed from `from` to the working tree, with statuses (`from` may be a merge base).
 * One diff over the whole range, so a file added in a commit and edited since is still added,
 * and a change that cancels out is gone. Untracked files read as added, as status reports them.
 */
export function gitWorktreeChanges(cwd: string, from: string): FileChange[] {
  const changes = withRenames(cwd, ['diff', '--name-status', '-z', '--ignore-submodules=dirty', from], true, { config: repoFilterOverrides(cwd) });
  const seen = new Set(changes.map((c) => c.path));
  for (const path of nulList(git(cwd, ['ls-files', '-z', '--others', '--exclude-standard']))) {
    if (!seen.has(path)) changes.push({ path, status: 'A' });
  }
  return changes;
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
      : git(cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--full-name']),
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
