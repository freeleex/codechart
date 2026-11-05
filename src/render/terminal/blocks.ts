import type { Field, Spec, SpecEdge, SpecNode } from '../../spec/schema.js';
import type { TermCtx } from './ctx.js';
import { gutter, kindLabel, paint } from './labels.js';
import { columns, fit, flat, truncate, wrapItems, type Segment } from './wrap.js';

const EDGE_MARK = { added: '+', removed: '-' } as const;
const FIELD_MARK = { added: '+', removed: '-', modified: '~' } as const;
// Past the marker column, so a host colouring diff lines leaves details plain.
const DETAIL = '    ';

const linksAmong = (spec: Spec, ids: Set<string>): SpecEdge[] =>
  spec.edges.filter((e) => ids.has(e.from) && ids.has(e.to));

const shownFields = (node: SpecNode): Field[] => {
  if (node.status === 'new') return node.fields ?? [];
  if (node.status === 'changed') return (node.fields ?? []).filter((f) => f.change !== undefined);
  return [];
};

const fieldItem = (f: Field): string =>
  flat(`${f.change ? FIELD_MARK[f.change] : ''}${f.name}${f.was !== undefined ? ` ${f.was} → ${f.type ?? '?'}` : f.type ? ` ${f.type}` : ''}`);

function arrowLines(head: Segment, links: SpecEdge[], byId: Map<string, SpecNode>, { width, color, cuts }: TermCtx): string[] {
  const indent = columns(head.text) + 1;
  const labels = links.map((e) => `${e.change ? EDGE_MARK[e.change] : ''}${flat(e.label ?? '')}`);
  const targets = links.map((e) => byId.get(e.to)!);
  const longest = Math.max(...labels.map(columns));
  const room = Math.min(...targets.map((t) => width - indent - 4 - columns(kindLabel(t))));
  const col = Math.min(longest, Math.max(room, Math.min(longest, Math.floor(width / 3))));
  return links.map((_, i) => {
    const label = labels[i]!;
    const shown = columns(label) <= col ? label : truncate(label, col, cuts);
    const arrow = `─${shown}${'─'.repeat(col - columns(shown) + 1)}▶`;
    const target = targets[i]!;
    return fit(
      [
        i === 0 ? head : { text: ' '.repeat(columns(head.text)) },
        { text: ` ${arrow} ` },
        { text: truncate(kindLabel(target), width - indent - 4 - col, cuts), paint: color ? (s: string) => paint(target, s) : undefined },
      ],
      width,
      cuts,
    );
  });
}

/** The node's headline with its links on aligned arrows, then its changed fields. */
function blockLines(node: SpecNode, links: SpecEdge[], fields: Field[], byId: Map<string, SpecNode>, ctx: TermCtx): string[] {
  const { width, color, cuts } = ctx;
  // With arrows to fit, a long name may take a third of the line; alone, all of it.
  const cap = links.length > 0 ? Math.floor(width / 3) : width - columns(gutter(node.status));
  const text = `${gutter(node.status)}${truncate(kindLabel(node), cap, cuts)}`;
  const head: Segment = { text, paint: color ? (s: string) => paint(node, s) : undefined };
  const lines = links.length > 0 ? arrowLines(head, links, byId, ctx) : [head.paint ? head.paint(text) : text];
  if (fields.length > 0) lines.push(wrapItems(DETAIL, fields.map(fieldItem), width));
  return lines;
}

/** Nodes among `ids` by layer: a block for every node that changed, links something, or has changed fields. */
export function renderBlocks(spec: Spec, ids: Set<string>, ctx: TermCtx, withFields: boolean): string {
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const links = linksAmong(spec, ids);
  const layers = [...new Set(spec.nodes.map((n) => n.layer))];
  const sections = layers.flatMap((layer) => {
    const blocks = spec.nodes
      .filter((n) => n.layer === layer && ids.has(n.id))
      .flatMap((n) => {
        const own = links.filter((e) => e.from === n.id);
        const fields = withFields ? shownFields(n) : [];
        // An unchanged node that only receives links is named where the arrows point.
        if (own.length === 0 && fields.length === 0 && n.status === 'context') return [];
        return blockLines(n, own, fields, byId, ctx);
      });
    return blocks.length > 0 ? [[truncate(flat(layer), ctx.width, ctx.cuts), ...blocks].join('\n')] : [];
  });
  return sections.join('\n\n');
}
