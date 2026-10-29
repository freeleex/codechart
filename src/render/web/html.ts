import type { Field, Spec, SpecNode } from '../../spec/schema.js';
import { wrapSummary, type Layout, type LayoutEdge } from './layout.js';
import { esc, list, midpoint, num, renderPage, type HtmlMeta } from './page.js';

export { esc, type Theme } from './page.js';

const FIELD_CHARS = 34;

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

const FIELD_MARK = { added: '+ ', removed: '- ', modified: '~ ' } as const;

function fieldText(f: Field): string {
  return `${f.change ? FIELD_MARK[f.change] : ''}${f.name}${f.type ? ': ' + f.type : ''}${f.note ? ' (' + f.note + ')' : ''}`;
}

function renderEdge(e: LayoutEdge): string {
  if (e.points.length < 2) return '';
  const d = e.points.map((p, i) => `${i ? 'L' : 'M'}${num(p.x)},${num(p.y)}`).join(' ');
  let out = `<path d="${d}" marker-end="url(#arrow)"/>`;
  if (e.label) {
    const m = midpoint(e.points);
    const w = e.label.length * 5.6 + 6;
    out +=
      `<rect x="${num(m.x - w / 2)}" y="${num(m.y - 8)}" width="${num(w)}" height="12" rx="2"/>` +
      `<text x="${num(m.x)}" y="${num(m.y + 1)}">${esc(e.label)}</text>`;
  }
  return `<g class="edge">${out}</g>`;
}

function renderNode(n: SpecNode, box: { x: number; y: number; w: number }): string {
  const x = Math.round(box.x * 10) / 10;
  const y = Math.round(box.y * 10) / 10;
  const w = box.w;
  const lines: string[] = [];
  let row = 28;
  const text = (cls: string, s: string): void => {
    lines.push(`<text class="${cls}" x="${x + 8}" y="${y + row + 12}">${esc(s)}</text>`);
    row += 16;
  };
  if (n.summary) for (const l of wrapSummary(n.summary)) text('summary', l);
  for (const f of n.fields ?? []) {
    text(f.change ? `field field-${f.change}` : 'field', clip(fieldText(f), FIELD_CHARS));
  }
  return (
    `<g class="node status-${n.status}" data-id="${esc(n.id)}" tabindex="0" role="button" aria-label="${esc(`${n.label} (${n.status})`)}">` +
    `<rect class="card" x="${x}" y="${y}" width="${w}" height="${row}" rx="6"/>` +
    `<line class="head" x1="${x}" y1="${y + 28}" x2="${x + w}" y2="${y + 28}"/>` +
    `<text class="label" x="${x + 8}" y="${y + 18}">${esc(clip(n.label, 22))}</text>` +
    `<text class="badge" x="${x + w - 8}" y="${y + 18}">${esc(n.status)}</text>` +
    lines.join('') +
    `</g>`
  );
}

const FIELDS_NOTE =
  'Only the fields the agent saw are listed. Set <code>defaults.context: full</code> in <code>.codechart.yaml</code> to let it read the full definition.';

function cardPanel(n: SpecNode): string {
  let out = `<h2>${esc(`${n.label} (${n.status} ${n.kind})`)}</h2>`;
  if (n.path) out += `<div class="path">${esc(n.path)}</div>`;
  if (n.summary) out += `<p>${esc(n.summary)}</p>`;
  if (n.fields?.length) {
    out += `<h3>Fields</h3><ul>${n.fields
      .map((f) => `<li${f.change ? ` class="field-${f.change}-t"` : ''}>${esc(fieldText(f))}</li>`)
      .join('')}</ul>`;
    if (n.fieldsComplete === false) out += `<p class="fields-note">${FIELDS_NOTE}</p>`;
  }
  if (n.notes?.length) out += `<h3>Notes</h3>${list(n.notes)}`;
  return `<template class="card-panel" data-for="${esc(n.id)}">${out}</template>`;
}

function pageInfo(spec: Spec): string {
  let out = '<p>Click a node for details. Scroll to zoom, drag to pan.</p>';
  if (spec.gaps?.length) out += `<h3>Gaps</h3>${list(spec.gaps)}`;
  if (spec.omitted?.length) out += `<h3>Not on map</h3>${list(spec.omitted)}`;
  return `<section id="page-info">${out}</section>`;
}

export function renderHtml(spec: Spec, layout: Layout, meta: HtmlMeta): string {
  const boxes = new Map(layout.nodes.map((n) => [n.id, n]));
  const groups = layout.groups
    .map(
      (g) =>
        `<g class="group"><rect x="${num(g.x)}" y="${num(g.y)}" width="${num(g.w)}" height="${num(g.h)}" rx="8"/>` +
        `<text x="${num(g.x + 10)}" y="${num(g.y + 16)}">${esc(g.layer)}</text></g>`,
    )
    .join('');
  const nodes = spec.nodes
    .map((n) => {
      const b = boxes.get(n.id);
      return b ? renderNode(n, b) : '';
    })
    .join('');
  const edges = layout.edges.map(renderEdge).join('');
  const infoButton =
    spec.gaps?.length || spec.omitted?.length
      ? '<button id="info-toggle" type="button" aria-controls="page-info" title="Show what is not on the map and what the agent did not read">Not on map / gaps</button>'
      : '';
  return renderPage({
    title: spec.title,
    meta,
    infoButton,
    viewport: `${groups}${edges}${nodes}`,
    aside: `${pageInfo(spec)}<div id="panel" hidden></div>${spec.nodes.map(cardPanel).join('')}`,
    width: layout.width,
    height: layout.height,
  });
}
