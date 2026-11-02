import { join, resolve } from 'node:path';
import { readRegularFile } from '../read-regular.js';
import { gitFileDiff, gitUntracked, type DiffRange } from '../rules/git-files.js';
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

/** An untracked file as an all-added diff. */
function untrackedDiff(root: string, rel: string): string | { note: string } {
  let tooBig = false;
  const text = readRegularFile(join(root, rel), (st) => st.isFile() && !(tooBig = st.size > MAX_BYTES));
  if (text === undefined) return { note: tooBig ? 'file is too large (over 5 MB)' : 'not a regular file' };
  if (text.includes('\0')) return 'Binary files differ';
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}`;
}

/**
 * The diff of each new, changed or removed node file in a summary, read from git over `range`.
 * A node whose file isn't in `diff` gets none: the check already flags it.
 */
export function nodePreviews(spec: Spec, root: string, diff: Diff, range: DiffRange, cwd?: string): Map<string, Preview> {
  const out = new Map<string, Preview>();
  if (spec.kind !== 'summary') return out;
  let left = MAX_TOTAL_BYTES;
  for (const node of spec.nodes) {
    if (node.path === undefined || !IN_DIFF.has(node.status)) continue;
    const rel = [repoPath(root, node.path), ...(cwd ? [repoPath(root, resolve(cwd, node.path))] : [])].find((p) => diff.hasFile(p));
    if (rel === undefined) continue;
    const note = (n: string) => out.set(node.id, { path: rel, lines: [], shown: 0, total: 0, note: n });
    if (left <= 0) {
      note('not shown: the diffs pass 25 MB together');
      continue;
    }
    let text: string | { note: string };
    try {
      text = gitFileDiff(root, range, rel);
      if (text === '' && range.worktree && gitUntracked(root, rel)) text = untrackedDiff(root, rel);
    } catch (e) {
      note(`diff not read (${(e as Error).message})`);
      continue;
    }
    if (typeof text !== 'string') {
      note(text.note);
      continue;
    }
    const bytes = Buffer.byteLength(text);
    left -= bytes;
    if (bytes > MAX_BYTES) note('diff is too large (over 5 MB)');
    else if (text !== '') out.set(node.id, parseDiff(rel, text));
  }
  return out;
}
