import { checkHeadline, type CheckSummary, type Mismatch } from '../terminal/check-lines.js';
import { esc, num } from './page.js';

/** What each kind of mismatch means for someone reading the diagram, keyed by `Mismatch.short`. */
const MEANING: Record<string, string> = {
  'file missing': "The agent pointed this box at a file that isn't in the repo: the path is wrong, or the file was renamed or deleted. Treat the box as unverified.",
  'not in diff': 'The agent says this changed, but git shows no change to its file in the checked range. The box may describe the change wrongly.',
  'match not found': "The agent quoted a line from this file as proof, but the file doesn't contain it. The box may describe code that isn't there.",
  'match on several lines': 'The line the agent quoted appears more than once in this file, so it does not prove which code the box means.',
  'file unreadable': "codechart couldn't read this file, so the box isn't verified.",
};

const CHECK_INTRO =
  "codechart checked what the agent drew against the repo's files and, when given one, the git diff. A ✗ marks a claim the code doesn't back up:";

const meaning = (m: Mismatch): string => MEANING[m.short] ?? '';

export function checkNote(c: CheckSummary | undefined): string {
  const line = checkHeadline(c);
  if (!line) return '';
  if (!c!.mismatches.length) return `<span class="check">${esc(line)}</span>`;
  return `<button type="button" class="check bad" aria-controls="page-info" title="Show what doesn't match and why">${esc(line)}</button>`;
}

export function checkSection(c: CheckSummary | undefined): string {
  if (!c?.mismatches.length) return '';
  const items = c.mismatches
    .map((m) => `<li><b>${esc(m.label)}</b>: ${esc(m.detail)}<br><span class="mismatch-why">${esc(meaning(m))}</span></li>`)
    .join('');
  return `<h3>Doesn't match the code</h3><p class="mismatch-why">${esc(CHECK_INTRO)}</p><ul>${items}</ul>`;
}

export function mismatchNote(c: CheckSummary | undefined, id: string): string {
  const m = c?.mismatches.find((x) => x.id === id);
  return m ? `<p class="mismatch-note">✗ ${esc(m.detail)}</p><p class="mismatch-why">${esc(meaning(m))}</p>` : '';
}

/** Hover text for a flagged box: the reason, so the ✗ explains itself without a click. */
export function flagTitle(c: CheckSummary | undefined, id: string): string {
  const m = c?.mismatches.find((x) => x.id === id);
  return m ? `<title>✗ ${esc(m.detail)}. ${esc(meaning(m))}</title>` : '';
}

/** A ✗ sitting on a shape's top-right corner. */
export const flagMark = (x: number, y: number): string => `<text class="flag" x="${num(x)}" y="${num(y + 4)}" aria-hidden="true">✗</text>`;
