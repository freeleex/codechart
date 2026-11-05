import { esc } from './page.js';

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
