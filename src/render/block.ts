import { clip } from './clip.js';
import { looksSecret, PRIVATE_KEY } from './secret.js';

/** Lines of a block shown open; the rest is folded behind "show more". */
export const BLOCK_MAX = 40;
/** Lines kept folded above and below what is shown; further lines are only counted. */
const CONTEXT = 100;
const WINDOW_BEFORE = 3;
const WINDOW_AFTER = 10;

/** The code an explain box shows: the block its quoted line opens, or the top of its file. */
export interface Block {
  path: string;
  /** Line number of `lines[0]`. */
  first: number;
  /** The shown part and the folded context around it, clipped. */
  lines: string[];
  /** `lines[from..to)` is shown open. */
  from: number;
  to: number;
  /** Index in `lines` of the quoted line. */
  hit?: number;
  /** File lines cut off above and below `lines`. */
  above: number;
  below: number;
}

const indentOf = (l: string) => l.length - l.trimStart().length;
const blank = (l: string) => l.trim() === '';

// Comments and strings first, so a brace in one doesn't count.
const NOISE = /\/\*.*?\*\/|\/\/.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;
const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0;
const depthChange = (l: string) => {
  const s = l.replace(NOISE, '');
  return count(s, /[{[(]/g) - count(s, /[}\])]/g);
};

/** The last line of the braces or brackets the line `m` opens; undefined when it opens none. Capped at `BLOCK_MAX` lines. */
function braceEnd(lines: string[], m: number): number | undefined {
  const stop = Math.min(lines.length, m + BLOCK_MAX);
  let depth = 0;
  for (let i = m; i < stop; i++) {
    depth += depthChange(lines[i]!);
    if (depth <= 0) return i === m ? undefined : i;
  }
  return stop - 1;
}

/** The last line from `last` on that is indented deeper than line `m`; blank lines inside count, trailing ones don't. */
function indentEnd(lines: string[], m: number, last: number): number {
  const base = indentOf(lines[m]!);
  let end = last;
  for (let i = last + 1; i < Math.min(lines.length, m + BLOCK_MAX); i++) {
    if (blank(lines[i]!)) continue;
    if (indentOf(lines[i]!) <= base) break;
    end = i;
  }
  return end;
}

/** `[start, end)` of the block line `m` opens: to the matching brace, else the lines indented deeper (Python, YAML), else a small window around it. */
function blockRange(lines: string[], m: number): [number, number] {
  const brace = braceEnd(lines, m);
  // `def f(\n a,\n):` closes its parentheses before the body starts.
  const end = brace === undefined || lines[brace]!.trimEnd().endsWith(':') ? indentEnd(lines, m, brace ?? m) : brace;
  if (end > m) return [m, Math.min(end + 1, m + BLOCK_MAX)];
  return [Math.max(0, m - WINDOW_BEFORE), Math.min(lines.length, m + WINDOW_AFTER + 1)];
}

/** Nothing for an empty file or one that looks like a secret. `matchLine`: 1-based line of the quoted text; without it the top of the file. */
export function blockOf(path: string, lines: string[], matchLine?: number): Block | undefined {
  if (lines.length === 0 || looksSecret(path) || PRIVATE_KEY.test(lines.join('\n'))) return undefined;
  const m = matchLine === undefined ? undefined : matchLine - 1;
  const [start, end] = m === undefined ? [0, Math.min(lines.length, BLOCK_MAX)] : blockRange(lines, m);
  const lo = Math.max(0, start - CONTEXT);
  const hi = Math.min(lines.length, end + CONTEXT);
  return {
    path,
    first: lo + 1,
    lines: lines.slice(lo, hi).map(clip),
    from: start - lo,
    to: end - lo,
    ...(m !== undefined && { hit: m - lo }),
    above: lo,
    below: lines.length - hi,
  };
}
