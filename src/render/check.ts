import { relative, resolve, sep } from 'node:path';
import type { FlowSpec } from '../spec/flow.js';
import type { Spec, SpecNode } from '../spec/schema.js';
import { anchorContext, findMatch, likelyPath, load, locate, type AnchorCtx, type FlowSnippets, type Snippet } from './flow/anchors.js';
import { blockOf, type Block } from './block.js';
import { stepLabel } from './flow/tree.js';
import { explains } from './omitted.js';
import type { CheckSummary, Mismatch } from './terminal/check-lines.js';
import { plainLabel } from './terminal/labels.js';

/** Files the change touched, repo-relative with `/`. A folder is in it when a file under it is. */
export interface Diff {
  files: readonly string[];
  has(path: string): boolean;
  /** Only a file, not a folder above one. */
  hasFile(path: string): boolean;
}

export function diffOf(files: string[]): Diff {
  const set = new Set(files);
  return {
    files: [...set],
    has: (p) => (p === '' ? files.length > 0 : set.has(p) || files.some((f) => f.startsWith(`${p}/`))),
    hasFile: (p) => set.has(p),
  };
}

export interface MapCheck extends CheckSummary {
  /** The line each node's `match` found. */
  matches: Map<string, Snippet>;
  /** The code each explain box shows. */
  blocks: Map<string, Block>;
  /** Where each node's file was found, repo-relative with `/`. */
  found: Map<string, string>;
}

interface CheckOptions {
  at?: string;
  cwd?: string;
  /** Reads files through this context, to share its read budget and cache with another check. */
  ctx?: AnchorCtx;
  /** Left out: the diff is not checked. */
  diff?: Diff;
  /** Changed files a summary map need not show. */
  ignored?: (file: string) => boolean;
}

export const repoPath = (root: string, path: string) => relative(root, resolve(root, path)).split(sep).join('/');

// A removed node may be a class deleted from a file that stays; a planned new file doesn't exist yet. An explain map's boxes with a path all exist.
const mustExist = (spec: Spec, node: SpecNode) => spec.kind === 'explain' || (spec.kind === 'plan' ? node.status !== 'new' : node.status !== 'removed');
export const IN_DIFF: ReadonlySet<string> = new Set(['new', 'changed', 'removed']);

type Problem = Pick<Mismatch, 'short' | 'detail'>;

// A deleted file can't be found on disk to tell a cwd-relative path from a root-relative one, so try both.
const inDiff = (c: AnchorCtx, path: string, diff: Diff) =>
  diff.has(repoPath(c.root, path)) || (c.cwd !== undefined && diff.has(repoPath(c.root, resolve(c.cwd, path))));

interface NodeCheck {
  problem?: Problem;
  /** Where the node's file was found, repo-relative with `/`. */
  found?: string;
  match?: Snippet;
  block?: Block;
}

function checkNode(c: AnchorCtx, spec: Spec, node: SpecNode & { path: string }, diff: Diff | undefined): NodeCheck {
  const needed = mustExist(spec, node);
  const where = locate(c, node.path);
  if ('error' in where) return { problem: { short: 'file unreadable', detail: where.error } };
  const found = where.found ? repoPath(c.root, where.path) : undefined;
  if (!where.found && needed) {
    const at = c.at ? ` at ${c.at.slice(0, 12)}` : '';
    return { problem: { short: 'file missing', detail: `${node.path} does not exist${at}${likelyPath(c, node.path)}` } };
  }
  if (diff && spec.kind === 'summary' && IN_DIFF.has(node.status) && !inDiff(c, where.path, diff)) {
    return { found, problem: { short: 'not in diff', detail: `marked ${node.status}, but ${where.path} isn't in the diff` } };
  }
  const explaining = spec.kind === 'explain';
  if (!needed || !where.found || (node.match === undefined && !explaining)) return { found };
  const loaded = load(c, where.path);
  if (loaded.lines === null || !Array.isArray(loaded.lines)) {
    // an explain box may name a folder or a file too big to read: there is no code to show
    if (node.match === undefined) return { found };
    return { found, problem: { short: 'file unreadable', detail: loaded.lines?.error ?? `${where.path} does not exist` } };
  }
  return { found, ...matchAndBlock(loaded.path, loaded.lines, node.match, explaining) };
}

/** The quoted line, if there is one, and for an explain box the block around it. */
function matchAndBlock(path: string, lines: string[], needle: string | undefined, explaining: boolean): Omit<NodeCheck, 'found'> {
  let match: Snippet | undefined;
  if (needle !== undefined) {
    const r = findMatch(path, needle, lines);
    if ('error' in r) return { problem: { short: r.error.endsWith(` not found in ${path}`) ? 'match not found' : 'match on several lines', detail: r.error } };
    match = r.snippet;
  }
  return { match, block: explaining ? blockOf(path, lines, match?.startLine) : undefined };
}

/** Checks each node with a `path` against the files (at `at`, or the working tree) and, given a diff, a summary's changes against it. */
export function checkMapNodes(spec: Spec, root: string, opts: CheckOptions = {}): MapCheck {
  const c = opts.ctx ?? anchorContext(root, opts.at, opts.cwd);
  const result: MapCheck = { checked: 0, mismatches: [], matches: new Map(), blocks: new Map(), found: new Map(), unit: spec.kind === 'explain' ? 'box' : 'node' };
  for (const node of spec.nodes) {
    if (node.path === undefined) continue;
    result.checked++;
    const { problem, found, match, block } = checkNode(c, spec, { ...node, path: node.path }, opts.diff);
    if (found) result.found.set(node.id, found);
    if (match) result.matches.set(node.id, match);
    if (block) result.blocks.set(node.id, block);
    if (problem) result.mismatches.push({ id: node.id, label: plainLabel(node), ...problem });
  }
  if (opts.diff && spec.kind === 'summary') {
    const uncovered = uncoveredFiles(c, spec, opts.diff, result.found, opts.ignored);
    if (uncovered.length) result.uncovered = uncovered;
  }
  return result;
}

const nodeRepoPaths = (c: AnchorCtx, path: string): string[] =>
  c.cwd === undefined ? [repoPath(c.root, path)] : [repoPath(c.root, path), repoPath(c.root, resolve(c.cwd, path))];

const under = (file: string, dir: string) => dir === '' || file === dir || file.startsWith(`${dir}/`);
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

// A rename's old path is in the diff too; a node at the new path with the same file name covers it.
function covered(c: AnchorCtx, file: string, paths: string[]): boolean {
  if (paths.some((p) => under(file, p))) return true;
  if (!paths.some((p) => baseName(p) === baseName(file))) return false;
  const where = locate(c, file);
  return 'found' in where && !where.found;
}

/** Changed files no node's path covers and no `omitted` entry names. */
function uncoveredFiles(c: AnchorCtx, spec: Spec, diff: Diff, found: Map<string, string>, ignored: (file: string) => boolean = () => false): string[] {
  // A file found on disk covers only where it was found; a missing one (deleted) may mean either path.
  const paths = spec.nodes.flatMap((n) => (n.path === undefined ? [] : found.has(n.id) ? [found.get(n.id)!] : nodeRepoPaths(c, n.path)));
  const omitted = spec.omitted ?? [];
  return diff.files.filter((f) => !ignored(f) && !omitted.some((o) => explains(o, f)) && !covered(c, f, paths));
}

/** `checked`: the anchors that resolved. A summary's new or changed step whose file isn't in `diff` is a mismatch. */
export function checkFlowDiff(spec: FlowSpec, snippets: FlowSnippets, checked: number, root: string, diff?: Diff): CheckSummary {
  const mismatches: Mismatch[] = [];
  if (diff && spec.kind === 'summary') {
    for (const step of spec.steps) {
      const snippet = snippets.steps.get(step.id);
      if (!snippet || (step.status !== 'new' && step.status !== 'changed')) continue;
      const path = snippet.source.replace(/:\d+(-\d+)?$/, '');
      if (diff.has(repoPath(root, path))) continue;
      mismatches.push({ id: step.id, label: stepLabel(step), short: 'not in diff', detail: `marked ${step.status}, but ${path} isn't in the diff` });
    }
  }
  return { checked, mismatches, unit: 'anchor' };
}
