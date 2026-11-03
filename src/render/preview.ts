import { realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { readRegularFile } from '../read-regular.js';
import { gitBlob, gitBlobSizes, gitFileDiff, gitUntracked, OutputTooLarge, type DiffRange } from '../rules/git-files.js';
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

const SECRET = { note: 'not shown: looks like a secret' };
const SECRET_NAME = /^(\.env(\..*)?|.*\.(pem|key|p12|pfx)|id_(rsa|dsa|ecdsa|ed25519).*|\.npmrc|\.netrc|\.pypirc|.*credentials.*)$/i;
const ENV_TEMPLATE = /^\.env\.(example|sample|template)$/i;
const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;

const looksSecret = (rel: string) => {
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  return SECRET_NAME.test(name) && !ENV_TEMPLATE.test(name);
};

const insideRoot = (root: string, path: string) => {
  try {
    const dir = realpathSync(dirname(path));
    const top = realpathSync(root);
    return dir === top || dir.startsWith(top + sep);
  } catch {
    return false;
  }
};

/** Bytes a render may still read, whole files and diffs together. */
interface Budget {
  left: number;
}

/**
 * The file on each side of the diff, whole: a key edited in the middle leaves its BEGIN line outside the hunk.
 * Sizes are checked before reading: a `diff` attribute would make git diff a big file as text anyway.
 */
function sides(root: string, range: DiffRange, rel: string, budget: Budget): string[] | { note: string } {
  const take = (size: number) => {
    if (size > MAX_BYTES) return TOO_LARGE;
    if (size > budget.left) return OVER_BUDGET;
    budget.left -= size;
    return undefined;
  };
  const texts: string[] = [];
  const sizes = gitBlobSizes(root, range.revs, rel);
  for (const [i, size] of sizes.entries()) {
    if (size === undefined) continue;
    const note = take(size);
    if (note) return { note };
    texts.push(gitBlob(root, range.revs[i]!, rel));
  }
  const path = join(root, rel);
  if (!range.worktree || !insideRoot(root, path)) return texts;
  let note: string | undefined;
  try {
    const text = readRegularFile(path, (st) => st.isFile() && !(note = take(st.size)));
    if (note) return { note };
    if (text !== undefined) texts.push(text);
  } catch {
    // deleted, or not a regular file: git has nothing to show from it either
  }
  return texts;
}

/** Reads at most `min(5 MB, budget)` bytes of diff, after both sides' files. */
function fileDiff(root: string, range: DiffRange, rel: string, budget: Budget): string | { note: string } {
  if (looksSecret(rel)) return SECRET;
  if (rel.includes('\n')) return { note: 'not shown: the file name has a line break' };
  let max = MAX_BYTES;
  try {
    const files = sides(root, range, rel, budget);
    if (!Array.isArray(files)) return files;
    if (files.some((t) => PRIVATE_KEY.test(t))) return SECRET;
    max = Math.min(MAX_BYTES, budget.left);
    if (max <= 0) return { note: OVER_BUDGET };
    const text = gitFileDiff(root, range, rel, max);
    const shown = text === '' && range.worktree && gitUntracked(root, rel) ? untrackedDiff(root, rel, max) : text;
    if (typeof shown !== 'string') return shown;
    budget.left -= Buffer.byteLength(shown);
    // a working-tree-encoding file reads as raw bytes above; git decodes it for the diff
    return PRIVATE_KEY.test(shown) ? SECRET : shown;
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
  const budget: Budget = { left: MAX_TOTAL_BYTES };
  for (const node of spec.nodes) {
    if (node.path === undefined || !IN_DIFF.has(node.status)) continue;
    const at = found.get(node.id);
    const candidates = at !== undefined ? [at] : [repoPath(root, node.path), ...(cwd ? [repoPath(root, resolve(cwd, node.path))] : [])];
    const rel = candidates.find((p) => diff.hasFile(p));
    if (rel === undefined) continue;
    if (!byFile.has(rel)) {
      const text = budget.left > 0 ? fileDiff(root, range, rel, budget) : { note: OVER_BUDGET };
      byFile.set(rel, typeof text !== 'string' ? { path: rel, lines: [], shown: 0, total: 0, note: text.note } : text === '' ? undefined : parseDiff(rel, text));
    }
    const preview = byFile.get(rel);
    if (preview) out.set(node.id, preview);
  }
  return out;
}
