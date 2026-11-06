import { CAUSE_LABEL, KIND_PHRASE, lower, type Drift, type DriftItem, type DriftKind } from '../drift.js';
import { itemsLine } from './check-lines.js';
import { flat, truncate, wrapItems } from './wrap.js';

const MAX_SHOWN = 5;
const MARK: Record<DriftKind, string> = { missing: '−', unplanned: '+', different: '~' };

const reasonOf = (i: DriftItem<unknown>): string => (i.cause === undefined ? 'no reason given' : `why: ${lower(CAUSE_LABEL[i.cause])}`);
const SGR: Record<DriftKind, string> = { missing: '31', unplanned: '32', different: '33' };

export interface DriftView {
  drift: Drift<unknown>;
  now: Date;
}

export function ageText(savedAt: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - Date.parse(savedAt)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

interface Room {
  width: number;
  color: boolean;
  htmlPath?: string;
}

/** The lines that tell how the build differs from its plan, for above the footer; empty without a plan. */
export function driftBlock(view: DriftView | undefined, { width, color, htmlPath }: Room): string {
  if (!view) return '';
  const { drift, now } = view;
  const title = `"${flat(drift.plan.title)}"`;
  const lines: string[] = [];
  if (drift.items.length === 0) {
    lines.push(truncate(`built as planned ✓ (plan ${title})`, width));
  } else {
    lines.push(truncate(`Plan vs built (plan ${title}, drawn ${ageText(drift.plan.savedAt, now)})`, width));
    for (const item of drift.items.slice(0, MAX_SHOWN)) {
      const head = `${item.cause === undefined ? '✗' : MARK[item.kind]} `;
      const what = `${flat(item.label)}  ${lower(KIND_PHRASE[item.kind])}${item.detail ? ` (${flat(item.detail)})` : ''}`;
      const reason = reasonOf(item);
      const paint = color ? (s: string) => `\u001b[${SGR[item.kind]}m${s}\u001b[0m` : undefined;
      lines.push(wrapItems(head, [{ text: what, paint }, reason], width));
      if (item.cause !== undefined) lines.push(wrapItems('    ', [`“${flat(item.why ?? '')}”`], width));
    }
    const more = drift.items.length - MAX_SHOWN;
    if (more > 0) lines.push(truncate(htmlPath ? `${more} more → full map` : `${more} more not shown`, width));
  }
  if (drift.strayReasons.length) lines.push(itemsLine('⚠ reasons without drift: ', drift.strayReasons.map(flat), width));
  return lines.join('\n');
}
