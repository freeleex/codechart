import { checkHeadline, flagged, type CheckSummary } from '../terminal/check-lines.js';
import { esc, num } from './page.js';

export function checkNote(c: CheckSummary | undefined): string {
  const line = checkHeadline(c);
  if (!line) return '';
  return `<span class="check${flagged(c) ? ' bad' : ''}">${esc(line)}</span>`;
}

export function checkSection(c: CheckSummary | undefined): string {
  let out = '';
  if (c?.mismatches.length) {
    const items = c.mismatches.map((m) => `<li><b>${esc(m.label)}</b>: ${esc(m.detail)}</li>`).join('');
    out += `<h3>Doesn't match the code</h3><ul>${items}</ul>`;
  }
  if (c?.uncovered?.length) {
    const items = c.uncovered.map((f) => `<li>${esc(f)}</li>`).join('');
    out += `<h3>Changed, not on map</h3><p>In the diff, but no node covers them and "Not on map" doesn't name them.</p><ul>${items}</ul>`;
  }
  return out;
}

export function mismatchNote(c: CheckSummary | undefined, id: string): string {
  const m = c?.mismatches.find((x) => x.id === id);
  return m ? `<p class="mismatch-note">✗ ${esc(m.detail)}</p>` : '';
}

export const isFlagged = (c: CheckSummary | undefined, id: string): boolean => c?.mismatches.some((m) => m.id === id) ?? false;

/** A ✗ sitting on a shape's top-right corner. */
export const flagMark = (x: number, y: number): string => `<text class="flag" x="${num(x)}" y="${num(y + 4)}" aria-hidden="true">✗</text>`;
