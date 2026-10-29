import type { Field, Spec, SpecNode } from '../../spec/schema.js';
import { columns, flat, truncate, wrapItems, type Cuts } from './wrap.js';
import { paint, plainLabel } from './labels.js';

const MARKER = { added: '+', removed: '-', modified: '~' } as const;

const shown = (node: SpecNode): Field[] => {
  if (node.status === 'new') return node.fields ?? [];
  if (node.status === 'changed') return (node.fields ?? []).filter((f) => f.change !== undefined);
  return [];
};

const item = (f: Field): string =>
  flat(`${f.change ? MARKER[f.change] : ''}${f.name}${f.type ? ` ${f.type}` : ''}`);

export function renderFieldLines(spec: Spec, ids: Set<string>, width: number, color: boolean, cuts: Cuts): string {
  const rows = spec.nodes
    .filter((n) => ids.has(n.id) && shown(n).length > 0)
    .map((n) => ({ node: n, label: plainLabel(n) }));
  // Align field lists, but don't let one long label push every list far right.
  const pad = Math.min(Math.max(0, ...rows.map((r) => columns(r.label))), Math.floor(width / 3));
  const lines = rows.map(({ node, label: full }) => {
    const label = truncate(full, pad, cuts);
    const gap = ' '.repeat(Math.max(pad - columns(label), 0) + 2);
    const head = `${color ? paint(node, label) : label}${gap}`;
    return wrapItems(head, shown(node).map(item), width);
  });
  return lines.length > 0 ? `${truncate('fields:', width)}\n${lines.join('\n')}` : '';
}
