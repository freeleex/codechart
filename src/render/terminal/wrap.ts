import { stripInvisible } from '../strip.js';

// Any control char would break the line-based drawing.
export const flat = (s: string): string => stripInvisible(s).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ');

const ANSI = /\u001b\[[0-9;]*m/g;
const ZERO = new Set([0xfe0f, 0x200d]);
const WIDE: [number, number][] = [
  [0x1100, 0x115f], [0x2699, 0x2699], [0x26aa, 0x26ab], [0x2705, 0x2705], [0x270f, 0x270f],
  [0x274c, 0x274c], [0x2e80, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f300, 0x1faff], [0x20000, 0x3fffd],
];

const charWidth = (ch: string): number => {
  const cp = ch.codePointAt(0)!;
  if (ZERO.has(cp)) return 0;
  return WIDE.some(([lo, hi]) => cp >= lo && cp <= hi) ? 2 : 1;
};

/** Terminal columns: wide CJK and emoji count 2, variation selector and ZWJ 0, ANSI escapes 0. */
export const columns = (s: string): number =>
  [...s.replace(ANSI, '')].reduce((n, ch) => n + charWidth(ch), 0);

/** The longest prefix of `text` that fits in `width` columns, and the rest. */
function split(text: string, width: number): [string, string] {
  const chars = [...text];
  let used = 0;
  let i = 0;
  for (; i < chars.length; i++) {
    used += charWidth(chars[i]!);
    if (used > width) break;
  }
  return [chars.slice(0, i).join(''), chars.slice(i).join('')];
}

export interface Cuts {
  truncated: boolean;
}

/** `text`, cut to `width` columns with a trailing `…`; flags `cuts` when it cut. */
export function truncate(text: string, width: number, cuts?: Cuts): string {
  if (columns(text) <= width) return text;
  if (cuts) cuts.truncated = true;
  return `${split(text, Math.max(width - 1, 0))[0]}…`;
}

interface WrapItem {
  text: string;
  /** Applied to each wrapped piece of the item, after wrapping, so escapes never count or split. */
  paint?: (piece: string) => string;
}

interface Piece {
  text: string;
  item?: WrapItem;
}

function renderPieces(pieces: Piece[]): string {
  const merged: Piece[] = [];
  for (const p of pieces) {
    const last = merged.at(-1);
    if (last && p.item && last.item === p.item) last.text += p.text;
    else merged.push({ ...p });
  }
  return merged.map((p) => (p.item?.paint ? p.item.paint(p.text) : p.text)).join('');
}

/**
 * `head a · b · c`, breaking between items, then between words, then inside a word,
 * so every line stays within `width`. Continuation lines are indented under the first item.
 */
export function wrapItems(head: string, items: (string | WrapItem)[], width: number): string {
  const indent = ' '.repeat(columns(head));
  const lines: string[] = [];
  let line: Piece[] = [{ text: head }];
  let fresh = true;
  const room = () => width - line.reduce((n, p) => n + columns(p.text), 0);
  const append = (text: string, item?: WrapItem) => {
    line.push({ text, item });
    fresh = false;
  };
  const newLine = () => {
    lines.push(renderPieces(line));
    line = [{ text: indent }];
    fresh = true;
  };

  items.forEach((raw, i) => {
    const item = typeof raw === 'string' ? { text: raw } : raw;
    const sep = i === 0 ? '' : ' · ';
    if (columns(sep + item.text) <= room()) {
      append(sep);
      return append(item.text, item);
    }
    if (!fresh) newLine();
    if (columns(item.text) <= room()) return append(item.text, item);
    for (const word of item.text.split(' ')) {
      if (!fresh && columns(` ${word}`) > room()) newLine();
      if (!fresh) append(' ', item);
      const chars = [...word];
      let at = 0;
      let remaining = columns(word);
      while (remaining > room() && fresh) {
        const w = room();
        let used = 0;
        let end = at;
        while (end < chars.length && used + charWidth(chars[end]!) <= w) used += charWidth(chars[end++]!);
        if (end === at) used = charWidth(chars[end++]!);
        append(chars.slice(at, end).join(''), item);
        remaining -= used;
        at = end;
        if (at < chars.length) newLine();
      }
      if (at < chars.length) append(chars.slice(at).join(''), item);
    }
  });
  lines.push(renderPieces(line));
  return lines.join('\n');
}

export interface Segment {
  text: string;
  paint?: (text: string) => string;
}

/** Segments joined, cut with `…` at the first one that overflows `width`; later segments are dropped. */
export function fit(segments: Segment[], width: number, cuts: Cuts): string {
  let left = width;
  let out = '';
  for (const { text, paint } of segments) {
    const cut = columns(text) <= left ? text : truncate(text, Math.max(left, 1), cuts);
    out += paint ? paint(cut) : cut;
    if (cut !== text) break;
    left -= columns(text);
  }
  return out;
}
