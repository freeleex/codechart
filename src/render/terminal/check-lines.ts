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
  /** Loose claims that don't fail the check: a field or an arrow the code doesn't back up. */
  warnings?: Mismatch[];
  unit: 'node' | 'box' | 'anchor';
  /** Boxes or nodes without a path, which the check can't look at. */
  notCheckable?: number;
  /** An explain map with flows: how many of `checked` are steps, the rest boxes. */
  steps?: number;
  /** Changed files no node covers and `omitted` doesn't name. */
  uncovered?: string[];
  /** A summary rendered in a repo without --git, --since or --commit. */
  diffUnchecked?: boolean;
}

const MAX_SHOWN = 5;
const UNCHECKED = 'diff not checked';

const units = (n: number, unit: string) => `${n} ${n === 1 ? unit : unit === 'box' ? 'boxes' : `${unit}s`}`;
const uncoveredHead = (n: number) => `✗ ${n} changed ${n === 1 ? 'file' : 'files'} not on map`;

export const flagged = (c: CheckSummary | undefined): boolean => Boolean(c?.mismatches.length || c?.uncovered?.length);

const notCheckable = (c: CheckSummary | undefined): string => (c?.notCheckable ? ` · ${c.notCheckable} not checkable` : '');

/** Appended to the footer's count line; empty when nothing could be checked. */
export function checkTag(c: CheckSummary | undefined): string {
  const unchecked = c?.diffUnchecked ? ` · ${UNCHECKED}` : '';
  if (!c || c.checked === 0) return `${notCheckable(c)}${unchecked}`;
  // A map's count line already says "nodes".
  const total = c.unit !== 'anchor' ? String(c.checked) : units(c.checked, c.unit);
  return ` · ✓ ${c.mismatches.length ? `${c.checked - c.mismatches.length} of ` : ''}${total} checked${notCheckable(c)}${unchecked}`;
}

export function itemsLine(head: string, all: string[], width: number): string {
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
  if (c.warnings?.length) {
    const w = c.warnings.length;
    lines.push(itemsLine(`⚠ ${w} ${w === 1 ? 'warning' : 'warnings'}: `, c.warnings.map((m) => `${flat(m.label)} ${flat(m.short)}`), width));
  }
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
  if (!tag) return truncate(counts, width);
  // Each part on its own line when they don't fit together, so "diff not checked" is never the part cut off.
  const parts = tag.replace(/^ · /, '').split(' · ');
  const joined = parts.join(' · ');
  const rest = columns(joined) <= width ? [joined] : parts.map((p) => truncate(p, width));
  return [truncate(counts, width), ...rest].join('\n');
}

type HeadlineTone = 'ok' | 'bad' | 'warn' | 'muted';

export interface HeadlinePart {
  text: string;
  /** How the HTML colors this part: a green ✓ next to a red ✗, not the whole line in one color. */
  tone: HeadlineTone;
}

/** The headline split per claim, so each part keeps its own tone. */
export function checkHeadlineParts(c: CheckSummary | undefined): HeadlinePart[] {
  if (!c) return [];
  const parts: HeadlinePart[] = [];
  const n = c.mismatches.length;
  // With flows, the count says boxes and steps: "9 boxes and 6 steps", or "✗ 1 of 15 boxes and steps".
  const total = c.steps ? `${units(c.checked - c.steps, 'box')} and ${units(c.steps, 'step')}` : units(c.checked, c.unit);
  const of = c.steps ? `${c.checked} boxes and steps` : total;
  if (c.checked > 0) {
    parts.push(n ? { text: `✗ ${n} of ${of} ${n === 1 ? "doesn't" : "don't"} match the code`, tone: 'bad' } : { text: `✓ ${total} checked against the code`, tone: 'ok' });
  }
  if (c.uncovered?.length) parts.push({ text: uncoveredHead(c.uncovered.length), tone: 'bad' });
  if (c.warnings?.length) parts.push({ text: `⚠ ${c.warnings.length} ${c.warnings.length === 1 ? 'warning' : 'warnings'}`, tone: 'warn' });
  if (c.diffUnchecked) parts.push({ text: UNCHECKED, tone: 'muted' });
  return parts;
}

export function checkHeadline(c: CheckSummary | undefined): string {
  return checkHeadlineParts(c)
    .map((p) => p.text)
    .join(' · ');
}
