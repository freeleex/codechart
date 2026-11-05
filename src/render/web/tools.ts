import { esc } from './page.js';

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

interface Relation {
  out: boolean;
  id: string;
  label: string;
  kind?: string;
}

/** The links of node `id`, each as the node on the other end. */
export function relationsOf(id: string, links: { from: string; to: string; kind?: string }[], labelOf: (id: string) => string): Relation[] {
  return links.flatMap((l) => {
    if (l.from !== id && l.to !== id) return [];
    const out = l.from === id;
    const other = out ? l.to : l.from;
    return [{ out, id: other, label: labelOf(other), ...(l.kind ? { kind: l.kind } : {}) }];
  });
}

export function relationsHtml(rels: Relation[]): string {
  if (!rels.length) return '';
  const rows = rels.map(
    (r) => `<li><button type="button" class="rel" data-goto="${esc(r.id)}">${r.out ? '→' : '←'} ${esc(r.label)}${r.kind ? ` (${esc(r.kind)})` : ''}</button></li>`,
  );
  return `<h3>Relations</h3><ul class="relations">${rows.join('')}</ul>`;
}
