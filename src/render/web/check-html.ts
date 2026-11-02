import { checkHeadline, type CheckSummary } from '../terminal/check-lines.js';
import { esc, num } from './page.js';

export function checkNote(c: CheckSummary | undefined): string {
  const line = checkHeadline(c);
  if (!line) return '';
  return `<span class="check${c!.mismatches.length ? ' bad' : ''}">${esc(line)}</span>`;
}

export function checkSection(c: CheckSummary | undefined): string {
  if (!c?.mismatches.length) return '';
  const items = c.mismatches.map((m) => `<li><b>${esc(m.label)}</b>: ${esc(m.detail)}</li>`).join('');
  return `<h3>Doesn't match the code</h3><ul>${items}</ul>`;
}

export function mismatchNote(c: CheckSummary | undefined, id: string): string {
  const m = c?.mismatches.find((x) => x.id === id);
  return m ? `<p class="mismatch-note">✗ ${esc(m.detail)}</p>` : '';
}

export const isFlagged = (c: CheckSummary | undefined, id: string): boolean => c?.mismatches.some((m) => m.id === id) ?? false;

/** A ✗ sitting on a shape's top-right corner. */
export const flagMark = (x: number, y: number): string => `<text class="flag" x="${num(x)}" y="${num(y + 4)}" aria-hidden="true">✗</text>`;
