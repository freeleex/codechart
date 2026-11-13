import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { readRegularFile } from '../../read-regular.js';
import { gitFileAt, gitListFiles } from '../../rules/git-files.js';
import { clip } from '../clip.js';
import { cleanPath } from '../drift.js';
import { looksSecret, PRIVATE_KEY } from '../secret.js';
import { hasHiddenChars } from '../strip.js';

const MAX_BYTES = 5 * 1024 * 1024;
// 200 anchored 5 MB files took 4 GB and 20 s before this cap.
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

/** `null`: the file does not exist. */
type Read = string[] | { error: string } | null;

const HIDDEN = 'not shown: looks like a secret';
/** `secret`: the name, or the file it resolves to, looks like one. `all`: the whole file, so a key body line is hidden even when its BEGIN line is not shown. */
export const shownLines = (secret: boolean, slice: string[], all: string[]): string[] => (secret || PRIVATE_KEY.test(all.join('\n')) ? [HIDDEN] : slice.map(clip));

const escapes = (rel: string) => rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
// .git/config (also a nested clone's) can hold a remote URL with a token.
const inGit = (rel: string) => rel.split(sep).some((s) => s.toLowerCase() === '.git');

const toLines = (text: string): string[] => {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};

interface Budget {
  left: number;
}

const overBudget = (path: string) => ({
  error: `${path} not read: the anchored files pass ${MAX_TOTAL_BYTES / 1024 / 1024} MB together; anchor fewer or smaller files`,
});

function readLinesAt(path: string, rel: string, root: string, sha: string, budget: Budget): Read {
  try {
    if (budget.left <= 0) return overBudget(path);
    const r = gitFileAt(root, sha, rel.split(sep).join('/'), MAX_BYTES);
    if (typeof r !== 'string') return r;
    budget.left -= Buffer.byteLength(r);
    return budget.left < 0 ? overBudget(path) : toLines(r);
  } catch (e) {
    return { error: `${path} cannot be read at ${sha.slice(0, 12)} (${(e as Error).message})` };
  }
}

function readLines(path: string, root: string, realRoot: string, budget: Budget): Read {
  let real: string;
  try {
    real = realpathSync(resolve(root, path));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? null : { error: `${path} cannot be read (${code})` };
  }
  const rel = relative(realRoot, real);
  if (escapes(rel)) return { error: `${path} is outside the repo` };
  if (inGit(rel)) return { error: `${path} is inside .git` };
  try {
    // A FIFO or device would block or never end; a huge file would be read whole.
    let refused: Read | undefined;
    const text = readRegularFile(real, (st) => {
      if (!st.isFile()) refused = { error: `${path} is not a regular file` };
      else if (st.size > MAX_BYTES) refused = { error: `${path} is too large (over 5 MB)` };
      else if (st.size > budget.left) refused = overBudget(path);
      else budget.left -= st.size;
      return refused === undefined;
    });
    return refused ?? toLines(text!);
  } catch (e) {
    return { error: `${path} cannot be read (${(e as NodeJS.ErrnoException).code})` };
  }
}

export interface Loaded {
  path: string;
  lines: Read;
  /** The path, or the in-repo file a symlink at it points to, looks like a secret. */
  secret: boolean;
}

/** Where `path` really is, repo-relative; undefined when it can't be resolved or is read from git (a symlink there is only its link text). */
function targetOf(c: AnchorCtx, path: string): string | undefined {
  if (c.at) return undefined;
  try {
    return relative(c.realRoot, realpathSync(resolve(c.root, path))).split(sep).join('/');
  } catch {
    return undefined;
  }
}

export interface AnchorCtx {
  root: string;
  realRoot: string;
  at: string | undefined;
  budget: Budget;
  /** Set only when the cwd differs from the root. */
  cwd: string | undefined;
  cache: Map<string, Loaded>;
  listing?: string[];
  tree?: Set<string>;
}

/** `at`: a commit sha to read the files from instead of the working tree. `cwd`: where cwd-relative paths resolve from. */
export function anchorContext(root: string, at?: string, cwd?: string): AnchorCtx {
  return {
    root,
    realRoot: realpathSync(root),
    at,
    budget: { left: MAX_TOTAL_BYTES },
    cwd: cwd !== undefined && resolve(cwd) !== resolve(root) ? resolve(cwd) : undefined,
    cache: new Map(),
  };
}

function refused(path: string, rel: string): { error: string } | undefined {
  if (isAbsolute(path) || escapes(rel)) return { error: `${path} is outside the repo` };
  if (inGit(rel)) return { error: `${path} is inside .git` };
  return undefined;
}

function read(c: AnchorCtx, path: string): Read {
  const rel = relative(c.root, resolve(c.root, path));
  const no = refused(path, rel);
  if (no) return no;
  return c.at ? readLinesAt(path, rel, c.root, c.at, c.budget) : readLines(path, c.root, c.realRoot, c.budget);
}

/** Whether `path` is a file or folder, without reading it. */
function present(c: AnchorCtx, path: string): boolean | { error: string } {
  const rel = relative(c.root, resolve(c.root, path));
  const no = refused(path, rel);
  if (no) return no;
  if (c.at) {
    c.tree ??= new Set(gitListFiles(c.root, c.at));
    const slashed = rel.split(sep).join('/');
    if (slashed === '' || c.tree.has(slashed)) return true;
    for (const f of c.tree) if (f.startsWith(`${slashed}/`)) return true;
    return false;
  }
  try {
    const real = realpathSync(resolve(c.root, path));
    if (escapes(relative(c.realRoot, real))) return { error: `${path} is outside the repo` };
    statSync(real);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? false : { error: `${path} cannot be read (${code})` };
  }
}

/** Paths are repo-root relative; one found only relative to the cwd is taken from there and reported repo-root relative. */
function withCwd<T>(c: AnchorCtx, path: string, get: (p: string) => T, missing: (v: T) => boolean): { path: string; value: T } {
  const direct = get(path);
  const outside = !isAbsolute(path) && escapes(relative(c.root, resolve(c.root, path)));
  if (c.cwd && (missing(direct) || outside)) {
    const rel = relative(c.root, resolve(c.cwd, path));
    if (rel !== '' && !escapes(rel)) {
      const alt = rel.split(sep).join('/');
      const value = get(alt);
      if (!missing(value)) return { path: alt, value };
    }
  }
  return { path, value: direct };
}

/** A path as `locate` finds it, repo-root relative, so one file has one spelling. */
export function repoPathResolver(root: string, at: string | undefined, cwd: string): (path: string) => string {
  const c = anchorContext(root, at, cwd);
  return (path) => {
    const clean = cleanPath(path);
    const r = locate(c, clean);
    return 'error' in r ? clean : r.path;
  };
}

export function load(c: AnchorCtx, path: string): Loaded {
  const hit = c.cache.get(path);
  if (hit) return hit;
  const { path: found, value } = withCwd(c, path, (p) => read(c, p), (v) => v === null);
  const target = targetOf(c, found);
  const loaded = { path: found, lines: value, secret: looksSecret(found) || (target !== undefined && looksSecret(target)) };
  c.cache.set(path, loaded);
  return loaded;
}

/** `found`: false when the file or folder does not exist. */
export function locate(c: AnchorCtx, path: string): { path: string; found: boolean } | { error: string } {
  const { path: found, value } = withCwd(c, path, (p) => present(c, p), (v) => v === false);
  return typeof value === 'boolean' ? { path: found, found: value } : value;
}

const MAX_LISTED_FILES = 200_000;

export function likelyPath(c: AnchorCtx, path: string): string {
  const slashed = path.replaceAll('\\', '/');
  if (isAbsolute(path) || slashed.split('/').includes('..')) return '';
  const tail = `/${slashed.replace(/^(\.\/)+/, '')}`;
  if (!c.listing) {
    try {
      c.listing = gitListFiles(c.root, c.at);
    } catch {
      c.listing = [];
    }
    if (c.listing.length > MAX_LISTED_FILES) c.listing = [];
  }
  const hits = c.listing.filter((f) => (f === tail.slice(1) || f.endsWith(tail)) && !hasHiddenChars(f));
  return hits.length === 1 ? `; did you mean ${hits[0]}` : '';
}
