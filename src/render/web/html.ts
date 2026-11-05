import type { Field, NodeKind, Spec, SpecEdge, SpecNode } from '../../spec/schema.js';
import { headerHeight, KIND_ROW, LABEL_LINE_HEIGHT, labelLines, wrapSummary, type Layout, type LayoutEdge } from './layout.js';
import type { MapCheck } from '../check.js';
import { codeRow, pathHtml, snippetHtml } from '../flow/html.js';
import type { Preview } from '../preview.js';
import { flagMark, flagTitle, mismatchNote } from './check-html.js';
import { gapsHtml, infoButton, pageInfoSection, renderDiagramPage, renderEdgeSvg } from './diagram.js';
import { CHANGE_ARROWS, esc, list, num, type HtmlMeta } from './page.js';
import { edgeChange, edgeOn, fieldsOn, hasNowAfter, nodeOn, SIDE_KEY, type Side } from './states.js';

export { esc, type Theme } from './page.js';

const FIELD_CHARS = 34;

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export const nodeWhat = (n: SpecNode): string => (n.kind === 'other' ? n.status : `${n.status} ${n.kind}`);

const FIELD_MARK = { added: '+ ', removed: '- ', modified: '~ ' } as const;

export function fieldText(f: Field): string {
  const type = f.was !== undefined ? `${f.was} → ${f.type ?? '?'}` : f.type;
  return `${f.change ? FIELD_MARK[f.change] : ''}${f.name}${type ? ': ' + type : ''}${f.note ? ' (' + f.note + ')' : ''}`;
}

function renderEdge(e: LayoutEdge, change: SpecEdge['change']): string {
  return renderEdgeSvg({
    points: e.points,
    marker: `arrow${change ? `-${change}` : ''}`,
    cls: `edge${change ? ` edge-${change}` : ''}`,
    label: e.label,
    lift: 8,
  });
}

type Shape = 'file' | 'data' | 'symbol' | 'other';

const SHAPE: Record<NodeKind, Shape> = {
  file: 'file',
  config: 'file',
  table: 'data',
  enum: 'data',
  model: 'data',
  service: 'symbol',
  endpoint: 'symbol',
  component: 'symbol',
  other: 'other',
};

const FOLD = 12;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The card outline: a file folds its corner, a data type doubles its header line, a code symbol has square corners. */
function cardShape(shape: Shape, { x, y, w, h }: Box, head: number): string {
  const r = x + w;
  if (shape === 'file') {
    return (
      `<path class="card" d="M${x},${y} H${r - FOLD} L${r},${y + FOLD} V${y + h} H${x} Z"/>` +
      `<path class="fold" d="M${r - FOLD},${y} V${y + FOLD} H${r}"/>`
    );
  }
  const card = `<rect class="card" x="${x}" y="${y}" width="${w}" height="${h}"${shape === 'symbol' ? '' : ' rx="6"'}/>`;
  return shape === 'data' ? card + `<line class="head" x1="${x}" y1="${y + head - 3}" x2="${r}" y2="${y + head - 3}"/>` : card;
}

/** `flag`: the hover title of a box that doesn't match the code, else empty. */
function renderNode(n: SpecNode, box: Box, flag: string, fields: Field[]): string {
  const flagged = flag !== '';
  const x = Math.round(box.x * 10) / 10;
  const y = Math.round(box.y * 10) / 10;
  const w = box.w;
  const lines: string[] = [];
  const head = headerHeight(n.label);
  let row = head;
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
  const shape = SHAPE[n.kind];
  const top = y + 18 + KIND_ROW;
  return (
    `<g class="node status-${n.status} shape-${shape}" data-id="${esc(n.id)}" tabindex="0" role="button" aria-label="${esc(`${n.label} (${nodeWhat(n)}${flagged ? ", doesn't match the code" : ''})`)}">` +
    flag +
    cardShape(shape, { x, y, w, h: height }, head) +
    `<line class="head" x1="${x}" y1="${y + head}" x2="${x + w}" y2="${y + head}"/>` +
    (n.kind === 'other' ? '' : `<text class="kind" x="${x + 8}" y="${y + 12}">${n.kind}</text>`) +
    labelLines(n.label).map((l, i) => `<text class="label" x="${x + 8}" y="${top + i * LABEL_LINE_HEIGHT}">${esc(l)}</text>`).join('') +
    `<text class="badge" x="${x + w - 8}" y="${top}">${esc(n.status)}</text>` +
    lines.join('') +
    (flagged ? flagMark(shape === 'file' ? x + w - FOLD - 6 : x + w, y) : '') +
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
  let out = `<h2>${esc(`${n.label} (${nodeWhat(n)})`)}</h2>`;
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
  const hint = 'Click a node for details. Scroll to zoom, drag to pan';
  return pageInfoSection(hint, sides, check, gapsHtml('Gaps', spec.gaps), gapsHtml('Not on map', spec.omitted));
}

/** Without `side`: the plan or summary as one picture, both states overlaid. */
export function viewport(spec: Spec, layout: Layout, check: MapCheck | undefined, side?: Side): string {
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
      return b ? renderNode(n, b, flagTitle(check, n.id), side ? fieldsOn(side, n) : (n.fields ?? [])) : '';
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
  return renderDiagramPage({
    title: spec.title,
    meta,
    check,
    infoButton: infoButton(check, Boolean(spec.gaps?.length || spec.omitted?.length), {
      mismatch: {
        label: 'Check / gaps',
        title: "Show what doesn't match the code, what is not on the map and what the agent did not read",
      },
      info: { label: 'Not on map / gaps', title: 'Show what is not on the map and what the agent did not read' },
    }),
    sides,
    paneKey: SIDE_KEY,
    viewport: (side) => viewport(spec, layout, check, side),
    aside: `${pageInfo(spec, check, sides)}<div id="panel" hidden></div>${spec.nodes.map((n) => cardPanel(n, check, previews, sides)).join('')}`,
    width: layout.width,
    height: layout.height,
    extraDefs: CHANGE_ARROWS,
  });
}
