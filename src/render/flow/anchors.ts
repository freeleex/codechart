import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { gitFileAt, gitListFiles } from '../../rules/git-files.js';
import type { FlowSpec } from '../../spec/flow.js';
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

type AnchorResult = { ok: true; snippets: FlowSnippets } | { ok: false; errors: string[] };

type Resolved = { snippet: Snippet } | { error: string; field?: 'match' };
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
    const st = statSync(real);
    if (!st.isFile()) return { error: `${path} is not a regular file` };
    if (st.size > MAX_BYTES) return { error: `${path} is too large (over 5 MB)` };
    if (st.size > budget.left) return overBudget(path);
    budget.left -= st.size;
    return toLines(readFileSync(real, 'utf8'));
  } catch (e) {
    return { error: `${path} cannot be read (${(e as NodeJS.ErrnoException).code})` };
  }
}

const MAX_LISTED = 10;
const SNIPPET_MAX_CHARS = 300;

// A minified or generated line would otherwise land whole in the HTML panel.
const clip = (l: string) => (l.length > SNIPPET_MAX_CHARS ? `${l.slice(0, SNIPPET_MAX_CHARS)}…` : l);

function lineList(hits: number[]): string {
  const shown = hits.slice(0, MAX_LISTED).join(', ');
  return hits.length > MAX_LISTED ? `${shown} and ${hits.length - MAX_LISTED} more` : shown;
}

function findMatch(path: string, match: string, lines: string[]): Resolved {
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

interface Loaded {
  path: string;
  lines: Read;
}

interface Ctx {
  root: string;
  realRoot: string;
  at: string | undefined;
  budget: Budget;
  /** Set only when the cwd differs from the root. */
  cwd: string | undefined;
  cache: Map<string, Loaded>;
  listing?: string[];
}

function read(c: Ctx, path: string): Read {
  const rel = relative(c.root, resolve(c.root, path));
  if (isAbsolute(path) || escapes(rel)) return { error: `${path} is outside the repo` };
  if (inGit(rel)) return { error: `${path} is inside .git` };
  return c.at ? readLinesAt(path, rel, c.root, c.at, c.budget) : readLines(path, c.root, c.realRoot, c.budget);
}

/** Paths are repo-root relative; one that exists only relative to the cwd is read from there and reported repo-root relative. */
function load(c: Ctx, path: string): Loaded {
  const hit = c.cache.get(path);
  if (hit) return hit;
  const direct = read(c, path);
  let loaded: Loaded = { path, lines: direct };
  const outside = !isAbsolute(path) && escapes(relative(c.root, resolve(c.root, path)));
  if (c.cwd && (direct === null || outside)) {
    const rel = relative(c.root, resolve(c.cwd, path));
    if (rel !== '' && !escapes(rel)) {
      const alt = rel.split(sep).join('/');
      const lines = read(c, alt);
      if (lines !== null) loaded = { path: alt, lines };
    }
  }
  c.cache.set(path, loaded);
  return loaded;
}

const MAX_LISTED_FILES = 200_000;

function likelyPath(c: Ctx, path: string): string {
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
  const hits = c.listing.filter((f) => f.endsWith(tail) && !hasHiddenChars(f));
  return hits.length === 1 ? `; did you mean ${hits[0]}` : '';
}

function resolveAnchor(source: string, match: string | undefined, c: Ctx): Resolved {
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
    return notFound(`${where}; repo root is ${c.root}${likelyPath(c, path)}`);
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

/** `at`: a commit sha to read the files from instead of the working tree. `cwd`: where cwd-relative paths resolve from. */
export function checkFlowAnchors(spec: FlowSpec, root: string, at?: string, cwd?: string): AnchorResult {
  const ctx: Ctx = {
    root,
    realRoot: realpathSync(root),
    at,
    budget: { left: MAX_TOTAL_BYTES },
    cwd: cwd !== undefined && resolve(cwd) !== resolve(root) ? resolve(cwd) : undefined,
    cache: new Map(),
  };
  const errors: string[] = [];
  const snippets: FlowSnippets = { steps: new Map(), links: {} };

  const check = (label: string, { source, match }: { source?: string; match?: string }, store: (s: Snippet) => void) => {
    if (!source) return;
    const r = resolveAnchor(source, match, ctx);
    if ('error' in r) errors.push(`${label}.${r.field ?? 'source'}: ${r.error}`);
    else store(r.snippet);
  };
  spec.steps.forEach((step, i) => check(`steps[${i}]`, step, (s) => snippets.steps.set(step.id, s)));
  spec.links.forEach((link, i) => check(`links[${i}]`, link, (s) => (snippets.links[i] = s)));

  return errors.length ? { ok: false, errors } : { ok: true, snippets };
}
