import type { Field, Spec, SpecEdge, SpecNode } from '../../spec/schema.js';
import { wrapSummary, type Layout, type LayoutEdge } from './layout.js';
import type { MapCheck } from '../check.js';
import { codeRow, pathHtml, snippetHtml } from '../flow/html.js';
import type { Preview } from '../preview.js';
import { checkNote, checkSection, flagMark, isFlagged, mismatchNote } from './check-html.js';
import { CHANGE_ARROWS, esc, list, midpoint, num, renderPage, type HtmlMeta } from './page.js';
import { edgeChange, edgeOn, fieldsOn, hasNowAfter, nodeOn, SIDE_KEY, SIDE_TITLE, SIDES, type Side } from './states.js';

export { esc, type Theme } from './page.js';

const FIELD_CHARS = 34;

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

const FIELD_MARK = { added: '+ ', removed: '- ', modified: '~ ' } as const;

function fieldText(f: Field): string {
  const type = f.was !== undefined ? `${f.was} → ${f.type ?? '?'}` : f.type;
  return `${f.change ? FIELD_MARK[f.change] : ''}${f.name}${type ? ': ' + type : ''}${f.note ? ' (' + f.note + ')' : ''}`;
}

function renderEdge(e: LayoutEdge, change: SpecEdge['change']): string {
  if (e.points.length < 2) return '';
  const d = e.points.map((p, i) => `${i ? 'L' : 'M'}${num(p.x)},${num(p.y)}`).join(' ');
  let out = `<path d="${d}" marker-end="url(#arrow${change ? `-${change}` : ''})"/>`;
  if (e.label) {
    const m = midpoint(e.points);
    const w = e.label.length * 5.6 + 6;
    out +=
      `<rect x="${num(m.x - w / 2)}" y="${num(m.y - 8)}" width="${num(w)}" height="12" rx="2"/>` +
      `<text x="${num(m.x)}" y="${num(m.y + 1)}">${esc(e.label)}</text>`;
  }
  return `<g class="edge${change ? ` edge-${change}` : ''}">${out}</g>`;
}

function renderNode(n: SpecNode, box: { x: number; y: number; w: number; h: number }, flagged: boolean, fields: Field[]): string {
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
  for (const f of fields) {
    text(f.change ? `field field-${f.change}` : 'field', clip(fieldText(f), FIELD_CHARS));
  }
  // The layout sized the card for every field on both sides; keep that so edges still meet it.
  const height = Math.max(row, Math.round(box.h * 10) / 10);
  return (
    `<g class="node status-${n.status}" data-id="${esc(n.id)}" tabindex="0" role="button" aria-label="${esc(`${n.label} (${n.status}${flagged ? ", doesn't match the code" : ''})`)}">` +
    `<rect class="card" x="${x}" y="${y}" width="${w}" height="${height}" rx="6"/>` +
    `<line class="head" x1="${x}" y1="${y + 28}" x2="${x + w}" y2="${y + 28}"/>` +
    `<text class="label" x="${x + 8}" y="${y + 18}">${esc(clip(n.label, 22))}</text>` +
    `<text class="badge" x="${x + w - 8}" y="${y + 18}">${esc(n.status)}</text>` +
    lines.join('') +
    (flagged ? flagMark(x + w, y) : '') +
    `</g>`
  );
}

const FIELDS_NOTE =
  'Only the fields the agent saw are listed. Set <code>defaults.context: full</code> in <code>.codechart.yaml</code> to let it read the full definition.';

const DIFF_MARK = { add: '+', del: '-', ctx: ' ' } as const;

function previewHtml(p: Preview): string {
  let out = '<h3>Changes</h3>';
  if (p.note) return `${out}<p class="more">${esc(p.note)}</p>`;
  const rows = p.lines.map((l) =>
    l.kind === 'hunk' ? codeRow(undefined, esc(l.text), 'd-hunk') : codeRow(l.n, esc(DIFF_MARK[l.kind] + l.text), `d-${l.kind}`),
  );
  out += `<pre class="snippet diff"><code>${rows.join('\n')}</code></pre>`;
  const count = p.shown < p.total ? `showing ${p.shown} of ${p.total} changed lines` : `${p.total} changed line${p.total === 1 ? '' : 's'}`;
  return `${out}<p class="more">${count} · whole file: <span class="path">${pathHtml(p.path)}</span></p>`;
}

const fieldList = (fields: Field[]) =>
  `<ul>${fields.map((f) => `<li${f.change ? ` class="field-${f.change}-t"` : ''}>${esc(fieldText(f))}</li>`).join('')}</ul>`;

function fieldsHtml(n: SpecNode, sides: boolean): string {
  if (!sides || !nodeOn('now', n.status) || !nodeOn('after', n.status)) return `<h3>Fields</h3>${fieldList(n.fields!)}`;
  const now = fieldsOn('now', n);
  const after = fieldsOn('after', n);
  if (JSON.stringify(now) === JSON.stringify(after)) return `<h3>Fields</h3>${fieldList(after)}`;
  return `<h3>Fields now</h3>${fieldList(now)}<h3>Fields after</h3>${fieldList(after)}`;
}

function cardPanel(n: SpecNode, check: MapCheck | undefined, previews: Map<string, Preview> | undefined, sides: boolean): string {
  let out = `<h2>${esc(`${n.label} (${n.status} ${n.kind})`)}</h2>`;
  out += mismatchNote(check, n.id);
  const match = check?.matches.get(n.id);
  if (match) out += snippetHtml(match);
  else if (n.path) out += `<div class="path">${pathHtml(n.path)}</div>`;
  if (n.summary) out += `<p>${esc(n.summary)}</p>`;
  const preview = previews?.get(n.id);
  if (preview) out += previewHtml(preview);
  if (n.fields?.length) {
    out += fieldsHtml(n, sides);
    if (n.fieldsComplete === false) out += `<p class="fields-note">${FIELDS_NOTE}</p>`;
  }
  if (n.notes?.length) out += `<h3>Notes</h3>${list(n.notes)}`;
  return `<template class="card-panel" data-for="${esc(n.id)}">${out}</template>`;
}

function pageInfo(spec: Spec, check: MapCheck | undefined, sides: boolean): string {
  let out = `<p>Click a node for details. Scroll to zoom, drag to pan${sides ? '; while "Panes: linked", both panes move together' : ''}.</p>`;
  out += checkSection(check);
  if (spec.gaps?.length) out += `<h3>Gaps</h3>${list(spec.gaps)}`;
  if (spec.omitted?.length) out += `<h3>Not on map</h3>${list(spec.omitted)}`;
  return `<section id="page-info">${out}</section>`;
}

/** Without `side`: the plan or summary as one picture, both states overlaid. */
function viewport(spec: Spec, layout: Layout, check: MapCheck | undefined, side?: Side): string {
  const boxes = new Map(layout.nodes.map((n) => [n.id, n]));
  const statusOf = new Map(spec.nodes.map((n) => [n.id, n.status]));
  const shown = spec.nodes.filter((n) => !side || nodeOn(side, n.status));
  const layers = new Set(shown.map((n) => n.layer));
  const present = new Set(shown.map((n) => n.id));
  const groups = layout.groups
    .filter((g) => layers.has(g.layer))
    .map(
      (g) =>
        `<g class="group"><rect x="${num(g.x)}" y="${num(g.y)}" width="${num(g.w)}" height="${num(g.h)}" rx="8"/>` +
        `<text x="${num(g.x + 10)}" y="${num(g.y + 16)}">${esc(g.layer)}</text></g>`,
    )
    .join('');
  const nodes = shown
    .map((n) => {
      const b = boxes.get(n.id);
      return b ? renderNode(n, b, isFlagged(check, n.id), side ? fieldsOn(side, n) : (n.fields ?? [])) : '';
    })
    .join('');
  const edges = layout.edges
    .map((e) => {
      const edge = spec.edges[e.index]!;
      const change = side ? edgeChange(edge, statusOf) : edge.change;
      const drawn = !side || (edgeOn(side, change) && present.has(edge.from) && present.has(edge.to));
      return drawn ? renderEdge(e, change) : '';
    })
    .join('');
  return `${groups}${edges}${nodes}`;
}

/** `previews`: each node's diff, when the render was given one. */
export function renderHtml(spec: Spec, layout: Layout, meta: HtmlMeta, check?: MapCheck, previews?: Map<string, Preview>): string {
  const sides = hasNowAfter(spec);
  const infoButton =
    check?.mismatches.length
      ? '<button id="info-toggle" type="button" aria-controls="page-info" title="Show what doesn\'t match the code, what is not on the map and what the agent did not read">Check / gaps</button>'
      : spec.gaps?.length || spec.omitted?.length
        ? '<button id="info-toggle" type="button" aria-controls="page-info" title="Show what is not on the map and what the agent did not read">Not on map / gaps</button>'
        : '';
  return renderPage({
    title: spec.title,
    meta,
    infoButton,
    headerNote: checkNote(check),
    viewport: sides ? '' : viewport(spec, layout, check),
    ...(sides
      ? { panes: SIDES.map((side) => ({ title: SIDE_TITLE[side], key: SIDE_KEY[side], viewport: viewport(spec, layout, check, side) })) }
      : {}),
    extraDefs: CHANGE_ARROWS,
    aside: `${pageInfo(spec, check, sides)}<div id="panel" hidden></div>${spec.nodes.map((n) => cardPanel(n, check, previews, sides)).join('')}`,
    width: layout.width,
    height: layout.height,
  });
}
