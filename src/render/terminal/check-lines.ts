import { flat, wrapItems } from './wrap.js';

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
  return wrapItems(`✗ ${n} ${n === 1 ? "claim doesn't" : "claims don't"} match the code: `, items, width);
}

export function checkHeadline(c: CheckSummary | undefined): string {
  if (!c || c.checked === 0) return '';
  const n = c.mismatches.length;
  const total = units(c.checked, c.unit);
  return n ? `✗ ${n} of ${total} ${n === 1 ? "doesn't" : "don't"} match the code` : `✓ ${total} checked against the code`;
}
