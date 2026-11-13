/* eslint-disable max-lines -- ratchet: grew past 250 in #24 (one error per missing file) before the gate; split when next touched */
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { readRegularFile } from '../../read-regular.js';
import { gitFileAt, gitListFiles } from '../../rules/git-files.js';
import type { FlowSpec } from '../../spec/flow.js';
import { clip } from '../clip.js';
import { hasHiddenChars } from '../strip.js';

const SNIPPET_MAX_LINES = 15;
const MAX_BYTES = 5 * 1024 * 1024;
// 200 anchored 5 MB files took 4 GB and 20 s before this cap.
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

export interface Snippet {
  source: string;
  startLine: number;
  lines: string[];
}

export interface FlowSnippets {
  steps: Map<string, Snippet>;
  links: Record<number, Snippet>;
}

/** `checked`: how many anchors resolved. */
type AnchorResult = { ok: true; snippets: FlowSnippets; checked: number } | { ok: false; errors: string[] };

/** `missing`: the anchored file does not exist; `detail` says where it was looked for. */
type Resolved = { snippet: Snippet } | { error: string; field?: 'match'; missing?: { path: string; detail: string } };
/** `null`: the file does not exist. */
type Read = string[] | { error: string } | null;

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

const MAX_LISTED = 10;

function lineList(hits: number[]): string {
  const shown = hits.slice(0, MAX_LISTED).join(', ');
  return hits.length > MAX_LISTED ? `${shown} and ${hits.length - MAX_LISTED} more` : shown;
}

export function findMatch(path: string, match: string, lines: string[]): Resolved {
  const needle = match.trim();
  const hits: number[] = [];
  lines.forEach((l, i) => {
    if (l.includes(needle)) hits.push(i + 1);
  });
  if (hits.length === 0) return { field: 'match', error: `"${needle}" not found in ${path}` };
  if (hits.length > 1) {
    return {
      field: 'match',
      error: `"${needle}" is on ${hits.length} lines of ${path} (${lineList(hits)}); quote a more distinctive piece of the line or drop match and use source '${path}:${hits[0]}'`,
    };
  }
  const line = hits[0]!;
  return { snippet: { source: `${path}:${line}`, startLine: line, lines: [clip(lines[line - 1]!)] } };
}

export interface Loaded {
  path: string;
  lines: Read;
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

export function load(c: AnchorCtx, path: string): Loaded {
  const hit = c.cache.get(path);
  if (hit) return hit;
  const { path: found, value } = withCwd(c, path, (p) => read(c, p), (v) => v === null);
  const loaded = { path: found, lines: value };
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

function resolveAnchor(source: string, match: string | undefined, c: AnchorCtx): Resolved {
  let path = source;
  let a = '';
  let b: string | undefined;
  if (match === undefined) {
    const m = /^(.+):(\d+)(?:-(\d+))?$/.exec(source);
    if (!m) return { error: `${source} not found (not path:line or path:start-end)` };
    [, path, a, b] = m as unknown as [string, string, string, string | undefined];
  }

  const loaded = load(c, path);
  const lines = loaded.lines;
  const notFound = (why: string) => ({ error: `${source} not found (${why})` });
  if (lines === null) {
    const where = c.at ? `file does not exist at ${c.at.slice(0, 12)}` : 'file does not exist';
    const hint = `repo root is ${c.root}${likelyPath(c, path)}`;
    return { error: `${source} not found (${where}; ${hint})`, missing: { path, detail: `${where} (${hint})` } };
  }
  if (!Array.isArray(lines)) return lines;
  if (match !== undefined) return findMatch(loaded.path, match, lines);

  const start = Number(a);
  const end = b === undefined ? start : Number(b);
  if (start < 1) return notFound('lines start at 1');
  if (start > end) return notFound('start is after end');
  if (end > lines.length) return notFound(`file has ${lines.length} lines`);
  return {
    snippet: {
      source: loaded.path === path ? source : `${loaded.path}:${a}${b === undefined ? '' : `-${b}`}`,
      startLine: start,
      lines: lines.slice(start - 1, Math.min(end, start - 1 + SNIPPET_MAX_LINES)).map(clip),
    },
  };
}

/** `steps[0..2,5].source`-style: the indexes of one group, runs of 3+ as ranges. */
function indexList(group: string, idx: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (idx[j + 1] === idx[j]! + 1) j++;
    if (j - i >= 2) parts.push(`${idx[i]}..${idx[j]}`);
    else for (let k = i; k <= j; k++) parts.push(String(idx[k]));
    i = j + 1;
  }
  return `${group}[${parts.join(',')}].source`;
}

/** An anchor that did not resolve. `at`: the index of the step or link; `missing` is set when its file does not exist. */
export interface AnchorFailure {
  group: 'steps' | 'links';
  at: number;
  field: 'source' | 'match';
  error: string;
  missing?: { path: string; detail: string };
}

/** Resolves every anchor of the flow; what it could not resolve is in `failures`. */
export function scanFlowAnchors(spec: Pick<FlowSpec, 'steps' | 'links'>, ctx: AnchorCtx): { snippets: FlowSnippets; checked: number; failures: AnchorFailure[] } {
  const snippets: FlowSnippets = { steps: new Map(), links: {} };
  const failures: AnchorFailure[] = [];
  let checked = 0;
  const check = (group: 'steps' | 'links', at: number, { source, match }: { source?: string; match?: string }, store: (s: Snippet) => void) => {
    if (!source) return;
    const r = resolveAnchor(source, match, ctx);
    if (!('error' in r)) {
      checked++;
      store(r.snippet);
      return;
    }
    failures.push({ group, at, field: r.field ?? 'source', error: r.error, ...(r.missing && { missing: r.missing }) });
  };
  spec.steps.forEach((step, i) => check('steps', i, step, (s) => snippets.steps.set(step.id, s)));
  spec.links.forEach((link, i) => check('links', i, link, (s) => (snippets.links[i] = s)));
  return { snippets, checked, failures };
}

/** `at`: a commit sha to read the files from instead of the working tree. `cwd`: where cwd-relative paths resolve from. */
export function checkFlowAnchors(spec: FlowSpec, root: string, at?: string, cwd?: string): AnchorResult {
  const { snippets, checked, failures } = scanFlowAnchors(spec, anchorContext(root, at, cwd));
  const errors: (string | undefined)[] = failures.map((f) => `${f.group}[${f.at}].${f.field}: ${f.error}`);
  const gone = new Map<string, { detail: string; at: number[]; uses: { group: string; i: number }[] }>();
  failures.forEach((f, k) => {
    if (!f.missing) return;
    const g = gone.get(f.missing.path) ?? { detail: f.missing.detail, at: [], uses: [] };
    g.at.push(k);
    g.uses.push({ group: f.group, i: f.at });
    gone.set(f.missing.path, g);
  });

  // Each repeat of the repo-root sentence costs tokens, so a file two or more anchors share is said once.
  for (const [path, g] of gone) {
    if (g.uses.length < 2) continue;
    const used = ['steps', 'links'].flatMap((group) => {
      const idx = g.uses.filter((u) => u.group === group).map((u) => u.i);
      return idx.length ? [indexList(group, idx)] : [];
    });
    errors[g.at[0]!] = `${path}: ${g.detail}; used by ${used.join(', ')}`;
    for (const k of g.at.slice(1)) errors[k] = undefined;
  }
  const out = errors.filter((e): e is string => e !== undefined);
  return out.length ? { ok: false, errors: out } : { ok: true, snippets, checked };
}
