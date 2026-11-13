import type { FlowSpec } from '../../spec/flow.js';
import { anchorContext, likelyPath, load, shownLines, type AnchorCtx } from './anchor-files.js';

const SNIPPET_MAX_LINES = 15;

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
  return { snippet: { source: `${path}:${line}`, startLine: line, lines: shownLines(path, [lines[line - 1]!]) } };
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
      lines: shownLines(loaded.path, lines.slice(start - 1, Math.min(end, start - 1 + SNIPPET_MAX_LINES))),
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
