import { columns, flat, truncate, wrapItems } from './wrap.js';

export interface Mismatch {
  id: string;
  /** With its status marker, as the diagram shows it. */
  label: string;
  /** A few words for the terminal line. */
  short: string;
  /** The full reason, for the HTML. */
  detail: string;
}

export interface CheckSummary {
  checked: number;
  mismatches: Mismatch[];
  unit: 'node' | 'anchor';
}

const MAX_SHOWN = 5;

const units = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** Appended to the footer's count line; empty when nothing could be checked. */
export function checkTag(c: CheckSummary | undefined): string {
  if (!c || c.checked === 0) return '';
  // A map's count line already says "nodes".
  const total = c.unit === 'node' ? String(c.checked) : units(c.checked, c.unit);
  return ` · ✓ ${c.mismatches.length ? `${c.checked - c.mismatches.length} of ` : ''}${total} checked`;
}

/** The line that opens the output when a claim doesn't match; empty otherwise. */
export function alertLine(c: CheckSummary | undefined, width: number): string {
  const n = c?.mismatches.length ?? 0;
  if (!c || n === 0) return '';
  const items = c.mismatches.slice(0, MAX_SHOWN).map((m) => `${flat(m.label)} ${m.short}`);
  if (n > MAX_SHOWN) items.push(`+${n - MAX_SHOWN} more`);
  const head = `✗ ${n} ${n === 1 ? "claim doesn't" : "claims don't"} match the code: `;
  // Wrapping indents under the head, which leaves too little room on a narrow terminal.
  if (columns(head) <= width / 2) return wrapItems(head, items, width);
  return `${truncate(head.trimEnd(), width)}\n${wrapItems('  ', items, width)}`;
}

/** The footer's count line with the check tag, which moves to its own line rather than being cut off. */
export function countLines(counts: string, c: CheckSummary | undefined, width: number): string {
  const tag = checkTag(c);
  if (columns(counts + tag) <= width) return counts + tag;
  return tag ? `${truncate(counts, width)}\n${truncate(tag.replace(/^ · /, ''), width)}` : truncate(counts, width);
}

export function checkHeadline(c: CheckSummary | undefined): string {
  if (!c || c.checked === 0) return '';
  const n = c.mismatches.length;
  const total = units(c.checked, c.unit);
  return n ? `✗ ${n} of ${total} ${n === 1 ? "doesn't" : "don't"} match the code` : `✓ ${total} checked against the code`;
}
