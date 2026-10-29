import type { Spec, SpecEdge, SpecNode } from '../../spec/schema.js';
import { paint, plainLabel, targetLabel } from './labels.js';
import { columns, fit, flat, truncate, type Cuts } from './wrap.js';

export const linksAmong = (spec: Spec, ids: Set<string>): SpecEdge[] =>
  spec.edges.filter((e) => ids.has(e.from) && ids.has(e.to));

function sourceLines(
  source: SpecNode,
  links: SpecEdge[],
  byId: Map<string, SpecNode>,
  width: number,
  color: boolean,
  cuts: Cuts,
) {
  const cap = Math.floor(width / 3);
  const name = truncate(plainLabel(source), cap, cuts);
  const indent = 2 + columns(name) + 1;
  const labels = links.map((e) => flat(e.label ?? ''));
  const targets = links.map((e) => byId.get(e.to)!);
  const longest = Math.max(...labels.map(columns));
  const room = Math.min(...targets.map((t) => width - indent - 4 - columns(targetLabel(t))));
  const col = Math.min(longest, Math.max(room, Math.min(longest, cap)));

  const painter = (node: SpecNode) => (color ? (text: string) => paint(node, text) : undefined);
  return links.map((_, i) => {
    const label = labels[i]!;
    const shown = columns(label) <= col ? label : truncate(label, col, cuts);
    const arrow = `─${shown}${'─'.repeat(col - columns(shown) + 1)}▶`;
    const target = targets[i]!;
    return fit(
      [
        { text: '  ' },
        i === 0 ? { text: name, paint: painter(source) } : { text: ' '.repeat(columns(name)) },
        { text: ` ${arrow} ` },
        { text: truncate(targetLabel(target), width - indent - 4 - col, cuts), paint: painter(target) },
      ],
      width,
      cuts,
    );
  });
}

/** Links among `ids`, grouped by source layer, one block per source with aligned arrows. */
export function renderLinks(spec: Spec, ids: Set<string>, width: number, color: boolean, cuts: Cuts = { truncated: false }): string {
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const links = linksAmong(spec, ids);
  const layers = [...new Set(spec.nodes.map((n) => n.layer))];
  const sections = layers.flatMap((layer) => {
    const blocks = spec.nodes
      .filter((n) => n.layer === layer)
      .flatMap((n) => {
        const own = links.filter((e) => e.from === n.id);
        return own.length > 0 ? sourceLines(n, own, byId, width, color, cuts) : [];
      });
    return blocks.length > 0 ? [[truncate(flat(layer), width, cuts), ...blocks].join('\n')] : [];
  });
  return sections.join('\n\n');
}
