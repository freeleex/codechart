import { join, resolve } from 'node:path';
import { readRegularFile } from '../read-regular.js';
import { gitFileDiff, gitUntracked, OutputTooLarge, type DiffRange } from '../rules/git-files.js';
import type { Spec } from '../spec/schema.js';
import { IN_DIFF, repoPath, type Diff } from './check.js';

const MAX_HUNKS = 3;
const MAX_LINES = 40;
const MAX_CHARS = 300;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

export interface PreviewLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk';
  /** New line number; the old one for a deleted line. */
  n?: number;
  text: string;
}

/** A node file's diff, capped. `note` replaces the lines when there is nothing to show (binary, too large). */
export interface Preview {
  path: string;
  lines: PreviewLine[];
  /** Changed lines shown, of `total`. */
  shown: number;
  total: number;
  note?: string;
}

const clip = (l: string) => (l.length > MAX_CHARS ? `${l.slice(0, MAX_CHARS)}…` : l);

/** Keeps the first hunks of a unified diff (headers skipped) and counts every changed line. */
export function parseDiff(path: string, text: string): Preview {
  const p: Preview = { path, lines: [], shown: 0, total: 0 };
  let hunks = 0;
  let oldN = 0;
  let newN = 0;
  const room = () => hunks <= MAX_HUNKS && p.lines.length < MAX_LINES;
  for (const raw of text.split('\n')) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      hunks++;
      oldN = Number(h[1]);
      newN = Number(h[2]);
      if (room()) p.lines.push({ kind: 'hunk', text: clip(raw) });
      continue;
    }
    if (hunks === 0) {
      if (/^Binary files .* differ$/.test(raw)) p.note = 'binary file';
      continue;
    }
    let line: PreviewLine;
    if (raw[0] === '+') line = { kind: 'add', n: newN++, text: raw.slice(1) };
    else if (raw[0] === '-') line = { kind: 'del', n: oldN++, text: raw.slice(1) };
    else if (raw[0] === ' ') {
      line = { kind: 'ctx', n: newN++, text: raw.slice(1) };
      oldN++;
    } else continue;
    if (line.kind !== 'ctx') p.total++;
    if (!room()) continue;
    p.lines.push({ ...line, text: clip(line.text.replace(/\r$/, '')) });
    if (line.kind !== 'ctx') p.shown++;
  }
  return p;
}

const TOO_LARGE = 'diff is too large (over 5 MB)';
const OVER_BUDGET = 'not shown: the diffs pass 25 MB together';

/** An untracked file as an all-added diff, read only if it fits in `max` bytes. */
function untrackedDiff(root: string, rel: string, max: number): string | { note: string } {
  let size = 0;
  const text = readRegularFile(join(root, rel), (st) => st.isFile() && (size = st.size) <= max);
  if (text === undefined) return { note: size > MAX_BYTES ? TOO_LARGE : size > max ? OVER_BUDGET : 'not a regular file' };
  if (text.includes('\0')) return { note: 'binary file' };
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}`;
}

/** Reads at most `min(5 MB, left)` bytes of diff. */
function fileDiff(root: string, range: DiffRange, rel: string, left: number): string | { note: string } {
  const max = Math.min(MAX_BYTES, left);
  try {
    const text = gitFileDiff(root, range, rel, max);
    return text === '' && range.worktree && gitUntracked(root, rel) ? untrackedDiff(root, rel, max) : text;
  } catch (e) {
    if (e instanceof OutputTooLarge) return { note: max < MAX_BYTES ? OVER_BUDGET : TOO_LARGE };
    return { note: `diff not read (${(e as Error).message})` };
  }
}

/**
 * The diff of each new, changed or removed node file in a summary, read from git over `range`.
 * `found`: the check's resolved file per node; a deleted file isn't found, so its cwd-relative spelling is tried too.
 * A node whose file isn't in `diff` gets none: the check already flags it.
 */
export function nodePreviews(spec: Spec, root: string, diff: Diff, range: DiffRange, found: Map<string, string>, cwd?: string): Map<string, Preview> {
  const out = new Map<string, Preview>();
  if (spec.kind !== 'summary') return out;
  const byFile = new Map<string, Preview | undefined>();
  let left = MAX_TOTAL_BYTES;
  for (const node of spec.nodes) {
    if (node.path === undefined || !IN_DIFF.has(node.status)) continue;
    const at = found.get(node.id);
    const candidates = at !== undefined ? [at] : [repoPath(root, node.path), ...(cwd ? [repoPath(root, resolve(cwd, node.path))] : [])];
    const rel = candidates.find((p) => diff.hasFile(p));
    if (rel === undefined) continue;
    if (!byFile.has(rel)) {
      const text = left > 0 ? fileDiff(root, range, rel, left) : { note: OVER_BUDGET };
      if (typeof text === 'string') left -= Buffer.byteLength(text);
      byFile.set(rel, typeof text !== 'string' ? { path: rel, lines: [], shown: 0, total: 0, note: text.note } : text === '' ? undefined : parseDiff(rel, text));
    }
    const preview = byFile.get(rel);
    if (preview) out.set(node.id, preview);
  }
  return out;
}
