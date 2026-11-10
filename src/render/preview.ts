import { lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { readRegularFile } from '../read-regular.js';
import { gitBlob, gitBlobs, gitBlobSizes, gitFileDiff, gitFileDiffs, gitUntracked, OutputTooLarge, plainDiffName, type DiffRange } from '../rules/git-files.js';
import type { Spec } from '../spec/schema.js';
import { IN_DIFF, repoPath, type Diff } from './check.js';
import { clip } from './clip.js';
import { generatedFiles } from './generated.js';
import { looksSecret, PRIVATE_KEY } from './secret.js';

/** Rows kept per file. */
const MAX_ROWS = 1000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

interface PreviewLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk';
  /** New line number; the old one for a deleted line. */
  n?: number;
  text: string;
}

/** A node file's diff, capped. `note` replaces the lines when there is nothing to show (binary, generated, too large). */
export interface Preview {
  path: string;
  /** The first `MAX_ROWS` rows. */
  lines: PreviewLine[];
  /** Changed lines in the whole diff. */
  total: number;
  /** Rows in the whole diff, hunk headers included. */
  rows: number;
  note?: string;
}

/** Keeps the first `MAX_ROWS` rows of a unified diff (headers skipped) and counts every row and changed line. */
export function parseDiff(path: string, text: string): Preview {
  const p: Preview = { path, lines: [], total: 0, rows: 0 };
  let hunks = 0;
  let oldN = 0;
  let newN = 0;
  const room = () => p.lines.length < MAX_ROWS;
  for (const raw of text.split('\n')) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      hunks++;
      oldN = Number(h[1]);
      newN = Number(h[2]);
      p.rows++;
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
    p.rows++;
    if (room()) p.lines.push({ ...line, text: clip(line.text.replace(/\r$/, '')) });
  }
  return p;
}

const TOO_LARGE = 'diff is too large (over 5 MB)';
const OVER_BUDGET = 'not shown: the diffs pass 25 MB together';
const GENERATED = { note: 'generated file, not shown' };

/** An untracked file as an all-added preview, read only if it fits in `max` bytes. */
function untrackedPreview(root: string, rel: string, budget: Budget, max: number): Preview | { note: string } {
  let size = 0;
  const text = readRegularFile(join(root, rel), (st) => st.isFile() && (size = st.size) <= max);
  if (text === undefined) return { note: size > MAX_BYTES ? TOO_LARGE : size > max ? OVER_BUDGET : 'not a regular file' };
  if (text.includes('\0')) return { note: 'binary file' };
  if (PRIVATE_KEY.test(text)) return SECRET;
  budget.left -= Buffer.byteLength(text);
  const all = text.split('\n');
  if (all[all.length - 1] === '') all.pop();
  const kept = all.slice(0, MAX_ROWS - 1);
  return {
    path: rel,
    lines: [
      { kind: 'hunk', text: `@@ -0,0 +1,${all.length} @@` },
      ...kept.map((l, i): PreviewLine => ({ kind: 'add', n: i + 1, text: clip(l.replace(/\r$/, '')) })),
    ],
    total: all.length,
    rows: all.length + 1,
  };
}

const SECRET = { note: 'not shown: looks like a secret' };

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

/** What git said for all of a render's files at once; whatever is missing is asked per file. */
interface Prefetch {
  sizes: Map<string, number | undefined>;
  blobs: Map<string, string>;
  diffs: Map<string, string>;
  untracked: Set<string>;
  untrackedKnown: Set<string>;
}

const noPrefetch = (): Prefetch => ({ sizes: new Map(), blobs: new Map(), diffs: new Map(), untracked: new Set(), untrackedKnown: new Set() });

const worktreeSize = (root: string, rel: string) => {
  const path = join(root, rel);
  return insideRoot(root, path) ? (lstatSync(path, { throwIfNoEntry: false })?.size ?? 0) : 0;
};

/**
 * Blob sizes, the blobs that fit, every diff and the untracked ones in a few git calls instead of a few per file.
 * Only files whose every side is within the per-file cap are diffed: git must not diff a huge file a `diff` attribute turned into text.
 * Files are taken in node order while their sides fit the render budget; the diffs get what is left of it.
 */
function prefetch(root: string, range: DiffRange, rels: string[], generated: Set<string>): Prefetch {
  const pre = noPrefetch();
  try {
    const cands = rels.filter((r) => !looksSecret(r) && !r.includes('\n') && !generated.has(r));
    const specs = cands.flatMap((r) => range.revs.map((rev) => `${rev}:${r}`));
    gitBlobSizes(root, specs).forEach((size, i) => pre.sizes.set(specs[i]!, size));

    let room = MAX_TOTAL_BYTES;
    const fits: string[] = [];
    const fetch: string[] = [];
    for (const r of cands) {
      const keys = range.revs.map((rev) => `${rev}:${r}`).filter((k) => pre.sizes.get(k) !== undefined);
      const sizes = [...keys.map((k) => pre.sizes.get(k)!), ...(range.worktree ? [worktreeSize(root, r)] : [])];
      if (sizes.some((n) => n > MAX_BYTES)) continue;
      const cost = sizes.reduce((a, b) => a + b, 0);
      if (cost > room) break;
      room -= cost;
      fits.push(r);
      fetch.push(...keys);
    }
    gitBlobs(root, fetch, fetch.map((s) => pre.sizes.get(s)!)).forEach((text, i) => pre.blobs.set(fetch[i]!, text));

    const batch = fits.filter(plainDiffName);
    const diffs = room > 0 ? gitFileDiffs(root, range, batch, room) : undefined;
    if (!diffs) return pre;
    for (const [rel, text] of diffs) pre.diffs.set(rel, text);
    if (range.worktree) {
      const empty = batch.filter((r) => diffs.get(r) === '');
      for (const r of gitUntracked(root, empty)) pre.untracked.add(r);
      for (const r of empty) pre.untrackedKnown.add(r);
    }
  } catch {
    // each file asks git itself and reports its own error
  }
  return pre;
}

/**
 * The file on each side of the diff, whole: a key edited in the middle leaves its BEGIN line outside the hunk.
 * Sizes are checked before reading: a `diff` attribute would make git diff a big file as text anyway.
 */
function sides(root: string, range: DiffRange, rel: string, budget: Budget, pre: Prefetch): string[] | { note: string } {
  const take = (size: number) => {
    if (size > MAX_BYTES) return TOO_LARGE;
    if (size > budget.left) return OVER_BUDGET;
    budget.left -= size;
    return undefined;
  };
  const texts: string[] = [];
  const keys = range.revs.map((rev) => `${rev}:${rel}`);
  const sizes = keys.every((k) => pre.sizes.has(k)) ? keys.map((k) => pre.sizes.get(k)) : gitBlobSizes(root, keys);
  for (const [i, size] of sizes.entries()) {
    if (size === undefined) continue;
    const note = take(size);
    if (note) return { note };
    texts.push(pre.blobs.get(keys[i]!) ?? gitBlob(root, range.revs[i]!, rel));
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
function fileDiff(root: string, range: DiffRange, rel: string, budget: Budget, pre: Prefetch, generated: Set<string>): string | Preview | { note: string } {
  if (looksSecret(rel)) return SECRET;
  if (rel.includes('\n')) return { note: 'not shown: the file name has a line break' };
  if (generated.has(rel)) return GENERATED;
  let max = MAX_BYTES;
  try {
    const files = sides(root, range, rel, budget, pre);
    if (!Array.isArray(files)) return files;
    if (files.some((t) => PRIVATE_KEY.test(t))) return SECRET;
    max = Math.min(MAX_BYTES, budget.left);
    if (max <= 0) return { note: OVER_BUDGET };
    const batched = pre.diffs.get(rel);
    if (batched !== undefined && Buffer.byteLength(batched) > max) throw new OutputTooLarge(`git output over ${max} bytes`);
    const text = batched ?? gitFileDiff(root, range, rel, max);
    const untracked = () => (pre.untrackedKnown.has(rel) ? pre.untracked.has(rel) : gitUntracked(root, [rel]).has(rel));
    const shown = text === '' && range.worktree && untracked() ? untrackedPreview(root, rel, budget, max) : text;
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
  const rels = new Map<string, string>();
  for (const node of spec.nodes) {
    if (node.path === undefined || !IN_DIFF.has(node.status)) continue;
    const at = found.get(node.id);
    const candidates = at !== undefined ? [at] : [repoPath(root, node.path), ...(cwd ? [repoPath(root, resolve(cwd, node.path))] : [])];
    const rel = candidates.find((p) => diff.hasFile(p));
    if (rel !== undefined) rels.set(node.id, rel);
  }
  const files = [...new Set(rels.values())];
  const generated = generatedFiles(root, files);
  const pre = prefetch(root, range, files, generated);
  const byFile = new Map<string, Preview | undefined>();
  const budget: Budget = { left: MAX_TOTAL_BYTES };
  for (const node of spec.nodes) {
    const rel = rels.get(node.id);
    if (rel === undefined) continue;
    if (!byFile.has(rel)) {
      const r = budget.left > 0 ? fileDiff(root, range, rel, budget, pre, generated) : { note: OVER_BUDGET };
      byFile.set(rel, typeof r === 'string' ? (r === '' ? undefined : parseDiff(rel, r)) : 'lines' in r ? r : { path: rel, lines: [], total: 0, rows: 0, note: r.note });
    }
    const preview = byFile.get(rel);
    if (preview) out.set(node.id, preview);
  }
  return out;
}
