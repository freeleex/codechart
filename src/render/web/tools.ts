import { createHash } from 'node:crypto';
import type { Preview } from '../preview.js';
import { esc, num } from './page.js';

const CHIP_ORDER = ['new', 'changed', 'removed', 'planned', 'config', 'context', 'existing', 'outside'];
const CHIP_MARK: Record<string, string> = { new: '+', changed: '~', removed: '−', planned: '○', config: '◆', context: '·', existing: '·', outside: '○' };
/** The statuses a "Δ changes only" chip fades. */
const UNCHANGED = ['context', 'existing'];

/** The toolbar's status key and filter: a chip per status present, led by "Δ changes only" when unchanged nodes exist. An explain map has nothing changed: only its Outside chip. */
export function statusChips(statuses: string[], explain = false): string {
  const counts = new Map<string, number>();
  for (const s of statuses) counts.set(s, (counts.get(s) ?? 0) + 1);
  const chips = CHIP_ORDER.filter((s) => counts.has(s) && (!explain || s === 'outside')).map(
    (s) =>
      `<button type="button" class="chip chip-${s}" data-status="${s}" aria-pressed="false" title="Fade ${s} nodes">${CHIP_MARK[s]}${counts.get(s)} ${s}</button>`,
  );
  const unchanged = explain ? undefined : UNCHANGED.find((s) => counts.has(s));
  if (unchanged) {
    chips.unshift(
      `<button type="button" class="chip chip-delta" data-delta="${unchanged}" aria-pressed="false" title="Fade ${unchanged} nodes, leaving only the changes">Δ changes only</button>`,
    );
  }
  return chips.length ? `<div id="chips" role="group" aria-label="Status filter">${chips.join('')}</div>` : '';
}

export const reviewControls = (total: number): string =>
  `<div id="review"><span id="review-count">0/${total} reviewed</span><span id="review-bar" aria-hidden="true"><i></i></span><button id="next-unreviewed" type="button" title="Next unreviewed: select the next node not ticked as reviewed" aria-label="Next unreviewed">Next ▸</button></div>`;

/** Ties a node's tick to its code: the hash changes when the node's diff does. */
export const diffRev = (p: Preview | undefined): string | undefined =>
  p ? createHash('sha256').update(JSON.stringify(p)).digest('hex').slice(0, 12) : undefined;

/** A tickbox centred on a node's top-left corner, clear of the label and badge. */
export const tickSvg = (x: number, y: number): string =>
  `<g class="tick" aria-hidden="true"><rect class="tick-hit" x="${num(x - 9)}" y="${num(y - 9)}" width="18" height="18"/>` +
  `<rect class="tick-box" x="${num(x - 6)}" y="${num(y - 6)}" width="12" height="12" rx="2"/>` +
  `<path class="tick-mark" d="M${num(x - 3)},${num(y)} L${num(x - 1)},${num(y + 3)} L${num(x + 3.5)},${num(y - 3)}"/></g>`;

/** A panel's header: the title with its Reviewed tickbox to the left (a ghost has none), and `summary` as a subheader. */
export const panelTitle = (id: string, text: string, tick = true, summary?: string): string =>
  `<div class="phead"><h2 class="ptitle">${tick ? `<input type="checkbox" data-tick-for="${esc(id)}" aria-label="Reviewed">` : ''}<span>${esc(text)}</span></h2>${summary ? `<p class="psub">${esc(summary)}</p>` : ''}</div>`;

interface Relation {
  out: boolean;
  id: string;
  label: string;
  kind?: string;
}

/** What a row says about the link: its label, else its kind unless that is "other". */
const note = (l: { label?: string; kind?: string }) => l.label || (l.kind !== 'other' ? l.kind : undefined);

/** The links of node `id`, each as the node on the other end. */
export function relationsOf(id: string, links: { from: string; to: string; label?: string; kind?: string }[], labelOf: (id: string) => string): Relation[] {
  return links.flatMap((l) => {
    if (l.from !== id && l.to !== id) return [];
    const out = l.from === id;
    const other = out ? l.to : l.from;
    return [{ out, id: other, label: labelOf(other), ...(note(l) ? { kind: note(l)! } : {}) }];
  });
}

const relList = (rels: Relation[]) =>
  rels.length
    ? `<ul>${rels.map((r) => `<li><button type="button" class="rel" data-goto="${esc(r.id)}">${esc(r.label)}${r.kind ? ` (${esc(r.kind)})` : ''}</button></li>`).join('')}</ul>`
    : '<p class="rel-none">none</p>';

/** A panel's body, then its relations in a `prel` block that the page moves into the footer pinned to the bottom of the side panel; none, no block. */
export const panelShell = (body: string, relations: string): string => `${body}${relations ? `<div class="prel">${relations}</div>` : ''}`;

/** Two columns that stack when the panel is narrow: what uses the node (incoming links) and what it uses (outgoing). */
export function relationsHtml(rels: Relation[]): string {
  if (!rels.length) return '';
  return (
    `<h3>Relations</h3><div class="relations">` +
    `<div class="rel-col"><h4>\u2190 Used by</h4>${relList(rels.filter((r) => !r.out))}</div>` +
    `<div class="rel-col"><h4>Uses \u2192</h4>${relList(rels.filter((r) => r.out))}</div></div>`
  );
}
