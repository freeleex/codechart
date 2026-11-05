import { createHash } from 'node:crypto';
import type { Preview } from '../preview.js';
import { esc, num } from './page.js';

const CHIP_ORDER = ['new', 'changed', 'removed', 'planned', 'config', 'context', 'existing'];
const CHIP_MARK: Record<string, string> = { new: '+', changed: '~', removed: '−', planned: '○', config: '◆', context: '·', existing: '·' };
/** The statuses a "Δ changes only" chip fades. */
const UNCHANGED = ['context', 'existing'];

/** The header's status key and filter: a chip per status present, led by "Δ changes only" when unchanged nodes exist. */
export function statusChips(statuses: string[]): string {
  const counts = new Map<string, number>();
  for (const s of statuses) counts.set(s, (counts.get(s) ?? 0) + 1);
  const chips = CHIP_ORDER.filter((s) => counts.has(s)).map(
    (s) =>
      `<button type="button" class="chip chip-${s}" data-status="${s}" aria-pressed="false" title="Fade ${s} nodes">${CHIP_MARK[s]}${counts.get(s)} ${s}</button>`,
  );
  const unchanged = UNCHANGED.find((s) => counts.has(s));
  if (unchanged) {
    chips.unshift(
      `<button type="button" class="chip chip-delta" data-delta="${unchanged}" aria-pressed="false" title="Fade ${unchanged} nodes, leaving only the changes">Δ changes only</button>`,
    );
  }
  return chips.length ? `<span id="chips" role="group" aria-label="Status filter">${chips.join('')}</span>` : '';
}

export const reviewControls = (total: number): string =>
  `<span id="review"><span id="review-count">0/${total} reviewed</span><button id="next-unreviewed" type="button" title="Next unreviewed: select the next node not ticked as reviewed" aria-label="Next unreviewed">Next ▸</button></span>`;

/** Ties a node's tick to its code: the hash changes when the node's diff does. */
export const diffRev = (p: Preview | undefined): string | undefined =>
  p ? createHash('sha256').update(JSON.stringify(p)).digest('hex').slice(0, 12) : undefined;

/** A tickbox centred on a node's top-left corner, clear of the label and badge. */
export const tickSvg = (x: number, y: number): string =>
  `<g class="tick" aria-hidden="true"><rect class="tick-hit" x="${num(x - 9)}" y="${num(y - 9)}" width="18" height="18"/>` +
  `<rect class="tick-box" x="${num(x - 6)}" y="${num(y - 6)}" width="12" height="12" rx="2"/>` +
  `<path class="tick-mark" d="M${num(x - 3)},${num(y)} L${num(x - 1)},${num(y + 3)} L${num(x + 3.5)},${num(y - 3)}"/></g>`;

export const tickRow = (id: string): string => `<label class="tick-row"><input type="checkbox" data-tick-for="${esc(id)}"> Reviewed</label>`;

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

export function relationsHtml(rels: Relation[]): string {
  if (!rels.length) return '';
  const rows = rels.map(
    (r) => `<li><button type="button" class="rel" data-goto="${esc(r.id)}">${r.out ? '→' : '←'} ${esc(r.label)}${r.kind ? ` (${esc(r.kind)})` : ''}</button></li>`,
  );
  return `<h3>Relations</h3><ul class="relations">${rows.join('')}</ul>`;
}
