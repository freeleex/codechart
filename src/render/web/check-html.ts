import { checkHeadlineParts, flagged, type CheckSummary, type Mismatch } from '../terminal/check-lines.js';
import { esc, num } from './page.js';

/** What each kind of mismatch means for someone reading the diagram, keyed by `Mismatch.short`. */
export const MEANING: Record<string, string> = {
  'file missing': "The agent pointed this box at a file that isn't in the repo: the path is wrong, or the file was renamed or deleted. Treat the box as unverified.",
  'not in diff': 'The agent says this changed, but git shows no change to its file in the checked range. The box may describe the change wrongly.',
  'match not found': "The agent quoted a line from this file as proof, but the file doesn't contain it. The box may describe code that isn't there.",
  'match on several lines': 'The line the agent quoted appears more than once in this file, so it does not prove which code the box means.',
  'line not found': "The agent pointed this step at a line that isn't in the file, so the step is unverified.",
  'outside the repo': "The agent pointed this box at a path outside the repo, which codechart doesn't read, so the box isn't verified.",
  'file unreadable': "codechart couldn't read this file, so the box isn't verified.",
};

const CHECK_INTRO =
  "codechart checked what the agent drew against the repo's files and, when given one, the git diff. A ✗ marks a claim the code doesn't back up:";

const WARN_INTRO = "These don't fail the check: a field or arrow may be described in another way.";

const STATUS_WHY =
  'The agent says this file is new, changed or removed, but git shows a different change to it. The box may describe the change wrongly.';

const FIELD_WHY = "A listed field isn't named in the file. It may be spelled differently, or the box may list a field the code doesn't have.";

const ARROW_WHY = "The file at the arrow's start doesn't mention the box at its end, by its file name or its name. The link may be wrong, or the code refers to it some other way.";

export const UNCOVERED_WHY =
  'The diff changes these files, but no box covers them and the agent didn\'t list them under "Not on map". The map may leave out part of the change.';

export const UNCHECKED_WHY =
  "Rendered without --git, --since or --commit, so codechart checked the files but not which ones this change touched.";

const meaning = (m: Mismatch): string =>
  MEANING[m.short] ??
  (m.short.startsWith('marked ') ? STATUS_WHY : m.short.startsWith('field ') ? FIELD_WHY : m.short.startsWith('no mention of ') ? ARROW_WHY : '');

export function checkNote(c: CheckSummary | undefined): string {
  const parts = checkHeadlineParts(c);
  if (!parts.length) return '';
  const line = parts.map((p) => `<span class="${p.tone}">${esc(p.text)}</span>`).join(' · ');
  if (flagged(c)) return `<button type="button" class="check bad" aria-controls="page-info" title="Show what doesn't match and why">${line}</button>`;
  if (c?.warnings?.length) return `<button type="button" class="check warn" aria-controls="page-info" title="Show what is worth checking">${line}</button>`;
  return `<span class="check"${c?.diffUnchecked ? ` title="${UNCHECKED_WHY}"` : ''}>${line}</span>`;
}

export function checkSection(c: CheckSummary | undefined): string {
  let out = '';
  if (c?.mismatches.length) {
    const items = c.mismatches
      .map((m) => `<li><b>${esc(m.label)}</b>: ${esc(m.detail)}<br><span class="mismatch-why">${esc(meaning(m))}</span></li>`)
      .join('');
    out += `<h3>Doesn't match the code</h3><p class="mismatch-why">${esc(CHECK_INTRO)}</p><ul>${items}</ul>`;
  }
  if (c?.uncovered?.length) {
    const items = c.uncovered.map((f) => `<li>${esc(f)}</li>`).join('');
    out += `<h3>Changed, not on map</h3><p class="mismatch-why">${esc(UNCOVERED_WHY)}</p><ul>${items}</ul>`;
  }
  if (c?.warnings?.length) {
    const items = c.warnings
      .map((m) => `<li class="warn-note"><b>${esc(m.label)}</b>: ${esc(m.detail)}<br><span class="mismatch-why">${esc(meaning(m))}</span></li>`)
      .join('');
    out += `<h3>Worth checking</h3><p class="mismatch-why">${esc(WARN_INTRO)}</p><ul>${items}</ul>`;
  }
  return out;
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
