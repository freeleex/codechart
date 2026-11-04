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
  /** Changed files no node covers and `omitted` doesn't name. */
  uncovered?: string[];
  /** A summary rendered in a repo without --git, --since or --commit. */
  diffUnchecked?: boolean;
}

const MAX_SHOWN = 5;
const UNCHECKED = 'diff not checked';

const units = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
const uncoveredHead = (n: number) => `✗ ${n} changed ${n === 1 ? 'file' : 'files'} not on map`;

export const flagged = (c: CheckSummary | undefined): boolean => Boolean(c?.mismatches.length || c?.uncovered?.length);

/** Appended to the footer's count line; empty when nothing could be checked. */
export function checkTag(c: CheckSummary | undefined): string {
  const unchecked = c?.diffUnchecked ? ` · ${UNCHECKED}` : '';
  if (!c || c.checked === 0) return unchecked;
  // A map's count line already says "nodes".
  const total = c.unit === 'node' ? String(c.checked) : units(c.checked, c.unit);
  return ` · ✓ ${c.mismatches.length ? `${c.checked - c.mismatches.length} of ` : ''}${total} checked${unchecked}`;
}

function itemsLine(head: string, all: string[], width: number): string {
  const items = all.slice(0, MAX_SHOWN);
  if (all.length > MAX_SHOWN) items.push(`+${all.length - MAX_SHOWN} more`);
  // Wrapping indents under the head, which leaves too little room on a narrow terminal.
  if (columns(head) <= width / 2) return wrapItems(head, items, width);
  return `${truncate(head.trimEnd(), width)}\n${wrapItems('  ', items, width)}`;
}

/** The lines that open the output when a claim doesn't match or a changed file is missing; empty otherwise. */
export function alertLine(c: CheckSummary | undefined, width: number): string {
  if (!c) return '';
  const lines: string[] = [];
  const n = c.mismatches.length;
  if (n) lines.push(itemsLine(`✗ ${n} ${n === 1 ? "claim doesn't" : "claims don't"} match the code: `, c.mismatches.map((m) => `${flat(m.label)} ${m.short}`), width));
  if (c.uncovered?.length) lines.push(itemsLine(`${uncoveredHead(c.uncovered.length)}: `, c.uncovered.map(flat), width));
  return lines.join('\n');
}

/** What stdout shows above the link when only the HTML has the diagram. */
export function webAlert(c: CheckSummary | undefined, width: number): string {
  return [alertLine(c, width), c?.diffUnchecked ? UNCHECKED : ''].filter(Boolean).join('\n');
}

/** The footer's count line with the check tag, which moves to its own line rather than being cut off. */
export function countLines(counts: string, c: CheckSummary | undefined, width: number): string {
  const tag = checkTag(c);
  if (columns(counts + tag) <= width) return counts + tag;
  return tag ? `${truncate(counts, width)}\n${truncate(tag.replace(/^ · /, ''), width)}` : truncate(counts, width);
}

export function checkHeadline(c: CheckSummary | undefined): string {
  if (!c) return '';
  const parts: string[] = [];
  const n = c.mismatches.length;
  const total = units(c.checked, c.unit);
  if (c.checked > 0) parts.push(n ? `✗ ${n} of ${total} ${n === 1 ? "doesn't" : "don't"} match the code` : `✓ ${total} checked against the code`);
  if (c.uncovered?.length) parts.push(uncoveredHead(c.uncovered.length));
  if (c.diffUnchecked) parts.push(UNCHECKED);
  return parts.join(' · ');
}
