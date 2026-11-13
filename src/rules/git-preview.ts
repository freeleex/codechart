import { git, OutputTooLarge } from './git-run.js';

/** What a file diff compares: `args` are the revisions; `revs`: the commits on its sides; `worktree`: the working tree is the new side. */
export interface DiffRange {
  args: string[];
  revs: string[];
  worktree: boolean;
  config: [string, string][];
}

/** Size of each `rev:path` object; undefined where it is not a blob. Paths must not hold a newline. */
export function gitBlobSizes(cwd: string, specs: string[]): (number | undefined)[] {
  if (!specs.length) return [];
  const out = git(cwd, ['cat-file', '--batch-check'], { input: specs.map((s) => `${s}\n`).join('') }).split('\n');
  return specs.map((_, i) => {
    const m = /^[0-9a-f]+ blob (\d+)$/.exec(out[i] ?? '');
    return m ? Number(m[1]) : undefined;
  });
}

/** The content of each `rev:path` blob, unfiltered; `sizes` are from `gitBlobSizes`, which parses the one-call output. */
export function gitBlobs(cwd: string, specs: string[], sizes: number[]): string[] {
  if (!specs.length) return [];
  const out = git(cwd, ['cat-file', '--batch'], { input: specs.map((s) => `${s}\n`).join(''), binary: true });
  const texts: string[] = [];
  let at = 0;
  for (const size of sizes) {
    const eol = out.indexOf(10, at);
    if (eol < 0 || !/^[0-9a-f]+ blob \d+$/.test(out.toString('latin1', at, eol))) throw new Error('git cat-file --batch: unexpected output');
    texts.push(out.toString('utf8', eol + 1, eol + 1 + size));
    at = eol + 1 + size + 1;
  }
  return texts;
}

/** `rel`'s content at `rev`, unfiltered. */
export function gitBlob(cwd: string, rev: string, rel: string): string {
  return git(cwd, ['cat-file', 'blob', `${rev}:${rel}`]);
}

// --src-prefix/--dst-prefix: a user's diff.noprefix would change the `diff --git` lines the batch splits on.
const diffArgs = (range: DiffRange, paths: string[]) => [
  '--literal-pathspecs', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--submodule=short', '--ignore-submodules=dirty',
  '--src-prefix=a/', '--dst-prefix=b/', '-U3', ...range.args, '--', ...paths,
];

/**
 * One file's unified diff over `range` (`rel` is repo-relative with `/`).
 * --no-ext-diff/--no-textconv: the repo's config must not make the diff run its commands.
 * bigFileThreshold: xdiff loads both sides in memory, so a huge compressible blob must come out as binary.
 * Throws `OutputTooLarge` past `maxBytes`.
 */
export function gitFileDiff(cwd: string, range: DiffRange, rel: string, maxBytes: number): string {
  return git(cwd, diffArgs(range, [rel]), { config: [['core.bigFileThreshold', '5m'], ...range.config], maxBuffer: maxBytes });
}

/** Each of `rels` with its `linguist-generated` attribute: true when set, false when unset or `false`, absent when unspecified. Paths must not hold a newline. */
export function gitGeneratedAttr(cwd: string, rels: string[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  if (!rels.length) return out;
  const parts = git(cwd, ['check-attr', '-z', '--stdin', 'linguist-generated'], { input: rels.map((r) => `${r}\0`).join('') }).split('\0');
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const value = parts[i + 2]!;
    if (value === 'unspecified') continue;
    out.set(parts[i]!, value !== 'unset' && value !== 'false');
  }
  return out;
}

const CHUNK_PATHS = 500;
const CHUNK_CHARS = 20_000;

function chunks(paths: string[]): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let chars = 0;
  for (const p of paths) {
    if (cur.length && (cur.length >= CHUNK_PATHS || chars + p.length > CHUNK_CHARS)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(p);
    chars += p.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** A name git prints bare in `diff --git` headers; others (quotes, backslash, control characters) it escapes. */
export const plainDiffName = (rel: string) => !/[\x00-\x1f\x7f"\\]/.test(rel);

/**
 * `gitFileDiff` for many files in few calls: the diff of each of `rels` (all `plainDiffName`), '' where unchanged.
 * undefined when the output of all calls together is over `maxBytes` or a section can't be matched to a requested file; the caller then diffs file by file.
 */
export function gitFileDiffs(cwd: string, range: DiffRange, rels: string[], maxBytes: number): Map<string, string> | undefined {
  const out = new Map<string, string>(rels.map((r) => [r, '']));
  const wanted = new Set(rels);
  let left = maxBytes;
  try {
    for (const group of chunks(rels)) {
      if (left <= 0) return undefined;
      const text = git(cwd, diffArgs(range, group), { config: [['core.bigFileThreshold', '5m'], ['core.quotePath', 'false'], ...range.config], maxBuffer: left });
      left -= Buffer.byteLength(text);
      const starts = [...text.matchAll(/^diff --git /gm)].map((m) => m.index);
      for (const [i, start] of starts.entries()) {
        const end = starts[i + 1] ?? text.length;
        const eol = text.indexOf('\n', start);
        const head = text.slice(start + 'diff --git '.length, eol < 0 ? end : eol);
        // --no-renames: both sides name the same path, so `a/P b/P` splits unambiguously
        const len = (head.length - 'a/ b/'.length) / 2;
        const rel = head.slice('a/'.length, 'a/'.length + len);
        if (!Number.isInteger(len) || head !== `a/${rel} b/${rel}` || !wanted.has(rel)) return undefined;
        out.set(rel, (out.get(rel) ?? '') + text.slice(start, end));
      }
    }
  } catch (e) {
    if (e instanceof OutputTooLarge) return undefined;
    throw e;
  }
  return out;
}

/** Those of `rels` that are untracked and not ignored. */
export function gitUntracked(cwd: string, rels: string[]): Set<string> {
  const found = new Set<string>();
  const wanted = new Set(rels);
  for (const group of chunks(rels)) {
    for (const f of git(cwd, ['--literal-pathspecs', 'ls-files', '-z', '--others', '--exclude-standard', '--', ...group]).split('\0')) {
      if (wanted.has(f)) found.add(f);
    }
  }
  return found;
}
