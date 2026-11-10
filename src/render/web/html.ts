import type { Field, NodeKind, Spec, SpecEdge, SpecNode } from '../../spec/schema.js';
import type { DriftItem } from '../drift.js';
import { headerHeight, KIND_ROW, LABEL_LINE_HEIGHT, labelLines, wrapSummary, type Layout, type LayoutEdge } from './layout.js';
import type { MapCheck } from '../check.js';
import { pathHtml, snippetHtml } from '../flow/html.js';
import type { Preview } from '../preview.js';
import { flagMark, flagTitle, mismatchNote } from './check-html.js';
import { blockHtml } from './block-html.js';
import { changesHtml } from './changes.js';
import { DRIFT_CSS, driftInfo, driftMark, driftSection, itemsById, type Ghosts } from './drift-html.js';
import { edgeEnds, gapsHtml, infoButton, pageInfoSection, renderDiagramPage, renderEdgeSvg, type EdgeEnds } from './diagram.js';
import { CHANGE_ARROWS, esc, list, num, type HtmlMeta } from './page.js';
import { edgeChange, edgeOn, fieldsOn, hasNowAfter, nodeOn, SIDE_KEY, type Side } from './states.js';
import { diffRev, panelShell, relationsHtml, relationsOf, panelTitle, tickSvg } from './tools.js';

export { esc, type Theme } from './page.js';

const FIELD_CHARS = 34;

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

const AREA_WORDS = { existing: 'in this area', outside: 'outside this area' } as const;

export function nodeWhat(n: SpecNode): string {
  if (n.status === 'existing' || n.status === 'outside') return n.kind === 'other' ? AREA_WORDS[n.status] : `${n.kind}, ${AREA_WORDS[n.status]}`;
  return n.kind === 'other' ? n.status : `${n.status} ${n.kind}`;
}

const FIELD_MARK = { added: '+ ', removed: '- ', modified: '~ ' } as const;

export function fieldText(f: Field): string {
  const type = f.was !== undefined ? `${f.was} → ${f.type ?? '?'}` : f.type;
  return `${f.change ? FIELD_MARK[f.change] : ''}${f.name}${type ? ': ' + type : ''}${f.note ? ' (' + f.note + ')' : ''}`;
}

function renderEdge(e: LayoutEdge, change: SpecEdge['change'], ends: EdgeEnds, ghost = false): string {
  return renderEdgeSvg({
    ends,
    points: e.points,
    marker: `arrow${change ? `-${change}` : ''}`,
    cls: `edge${change ? ` edge-${change}` : ''}${ghost ? ' ghost' : ''}`,
    label: e.label,
    labelAt: e.labelAt,
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

/** `flag`: the hover title of a box that doesn't match the code, else empty. `drift`: how it differs from the plan; `ghost`: the plan had it, the build lacks it. */
function renderNode(n: SpecNode, box: Box, flag: string, fields: Field[], rev: string | undefined, mark?: { drift: DriftItem<SpecNode>; ghost: boolean }): string {
  const { drift, ghost = false } = mark ?? {};
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
    `<g class="node status-${n.status} shape-${shape}${ghost ? ' ghost' : ''}" data-id="${esc(n.id)}" data-label="${esc(n.label)}" data-status="${n.status}"${rev ? ` data-rev="${rev}"` : ''} tabindex="0" role="button" aria-label="${esc(`${n.label} (${nodeWhat(n)}${flagged ? ", doesn't match the code" : ''}${drift ? `, ${drift.kind === 'missing' ? 'in the plan, not built' : 'differs from the plan'}` : ''})`)}">` +
    flag +
    cardShape(shape, { x, y, w, h: height }, head) +
    `<line class="head" x1="${x}" y1="${y + head}" x2="${x + w}" y2="${y + head}"/>` +
    (n.kind === 'other' ? '' : `<text class="kind" x="${x + 8}" y="${y + 12}">${n.kind}</text>`) +
    labelLines(n.label).map((l, i) => `<text class="label" x="${x + 8}" y="${top + i * LABEL_LINE_HEIGHT}">${esc(l)}</text>`).join('') +
    (n.status === 'existing' ? '' : `<text class="badge" x="${x + w - 8}" y="${top}">${esc(ghost ? 'not built' : n.status)}</text>`) +
    lines.join('') +
    (ghost ? '' : tickSvg(x, y)) +
    (flagged ? flagMark(shape === 'file' ? x + w - FOLD - 6 : x + w, y) : '') +
    (drift ? driftMark(drift, x + w, y + height + 8) : '') +
    `</g>`
  );
}

const FIELDS_NOTE =
  'Only the fields the agent saw are listed. Set <code>defaults.context: full</code> in <code>.codechart.yaml</code> to let it read the full definition.';

const fieldList = (fields: Field[]) =>
  `<ul>${fields.map((f) => `<li${f.change ? ` class="field-${f.change}-t"` : ''}>${esc(fieldText(f))}</li>`).join('')}</ul>`;

function fieldsHtml(n: SpecNode, sides: boolean): string {
  if (!sides || !nodeOn('now', n.status) || !nodeOn('after', n.status)) return `<h3>Fields</h3>${fieldList(n.fields!)}`;
  const now = fieldsOn('now', n);
  const after = fieldsOn('after', n);
  if (JSON.stringify(now) === JSON.stringify(after)) return `<h3>Fields</h3>${fieldList(after)}`;
  return `<h3>Fields now</h3>${fieldList(now)}<h3>Fields after</h3>${fieldList(after)}`;
}

function cardPanel(spec: Spec, n: SpecNode, check: MapCheck | undefined, previews: Map<string, Preview> | undefined, sides: boolean, mark?: { drift: DriftItem<SpecNode>; ghost: boolean }): string {
  const ghost = mark?.ghost ?? false;
  let out = panelTitle(n.id, `${n.label} (${ghost ? 'not built' : nodeWhat(n)})`, !ghost, n.summary);
  out += mismatchNote(check, n.id);
  const match = check?.matches.get(n.id);
  const preview = previews?.get(n.id);
  const block = check?.blocks.get(n.id);
  if (block) out += blockHtml(block);
  else if (match) out += snippetHtml(match);
  else if (n.path && !preview) out += `<div class="path">${pathHtml(n.path)}</div>`;
  out += driftSection(mark?.drift, ghost);
  if (preview) out += changesHtml(preview);
  if (n.fields?.length) {
    out += fieldsHtml(n, sides);
    if (n.fieldsComplete === false) out += `<p class="fields-note">${FIELDS_NOTE}</p>`;
  }
  if (n.notes?.length) out += `<h3>Notes</h3>${list(n.notes)}`;
  return `<template class="card-panel" data-for="${esc(n.id)}">${panelShell(out, relationsHtml(relationsOf(n.id, spec.edges, labelOf(spec))))}</template>`;
}

const mark = (drift: DriftItem<SpecNode> | undefined, ghost: boolean) => (drift ? { drift, ghost } : undefined);

const labelOf = (spec: Spec) => (id: string) => spec.nodes.find((n) => n.id === id)?.label ?? id;

function pageInfo(spec: Spec, check: MapCheck | undefined, sides: boolean, ghosts: Ghosts<SpecNode, SpecEdge> | undefined, now: Date): string {
  const hint = 'Click a node for details. Scroll to zoom, drag to pan';
  return pageInfoSection(hint, sides, check, driftInfo(ghosts?.drift, now), gapsHtml('Gaps', spec.gaps, 'gap'), gapsHtml('Not on map', spec.omitted, 'omitted'));
}

/** The spec with the plan's missing nodes and their links added, to lay out and draw. */
export const withGhosts = (spec: Spec, ghosts: Ghosts<SpecNode, SpecEdge> | undefined): Spec =>
  ghosts ? { ...spec, nodes: [...spec.nodes, ...ghosts.nodes], edges: [...spec.edges, ...ghosts.links] } : spec;

/** Without `side`: the plan or summary as one picture, both states overlaid. `spec` is laid out with its ghosts. */
export function viewport(spec: Spec, layout: Layout, check: MapCheck | undefined, side?: Side, previews?: Map<string, Preview>, ghosts?: Ghosts<SpecNode, SpecEdge>): string {
  const drifted = itemsById(ghosts?.drift);
  const ghostIds = new Set(ghosts?.nodes.map((g) => g.id));
  const ghostEdges = new Set(ghosts?.links);
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
      return b ? renderNode(n, b, flagTitle(check, n.id), side ? fieldsOn(side, n) : (n.fields ?? []), diffRev(previews?.get(n.id)), mark(drifted.get(n.id), ghostIds.has(n.id))) : '';
    })
    .join('');
  const edges = layout.edges
    .map((e) => {
      const edge = spec.edges[e.index]!;
      const change = side ? edgeChange(edge, statusOf) : edge.change;
      const drawn = !side || (edgeOn(side, change) && present.has(edge.from) && present.has(edge.to));
      return drawn ? renderEdge(e, change, edgeEnds(edge.from, edge.to, labelOf(spec)), ghostEdges.has(edge)) : '';
    })
    .join('');
  return `${groups}${edges}${nodes}`;
}

/** `previews`: each node's diff, when the render was given one. `ghosts`: a summary's drift from its plan; `layout` is of `withGhosts(spec, ghosts)`. */
export function renderHtml(spec: Spec, layout: Layout, meta: HtmlMeta, check?: MapCheck, previews?: Map<string, Preview>, ghosts?: Ghosts<SpecNode, SpecEdge>): string {
  const sides = hasNowAfter(spec);
  const all = withGhosts(spec, ghosts);
  const drifted = itemsById(ghosts?.drift);
  const ghostIds = new Set(ghosts?.nodes.map((g) => g.id));
  const drift = Boolean(ghosts?.drift.items.length);
  const explain = spec.kind === 'explain';
  return renderDiagramPage({
    title: spec.title,
    meta,
    check,
    drift: ghosts?.drift,
    infoButton: infoButton(check, Boolean(spec.gaps?.length || spec.omitted?.length || drift), {
      mismatch: {
        label: drift ? 'Check / differences / gaps' : 'Check / gaps',
        title: "Show what doesn't match the code, how the build differs from the plan, what is not on the map and what the agent did not read",
      },
      info: explain
        ? { label: 'Gaps', title: 'Show what the agent did not read' }
        : drift
          ? { label: 'Differences / gaps', title: 'Show how the build differs from the plan, what is not on the map and what the agent did not read' }
          : { label: 'Not on map / gaps', title: 'Show what is not on the map and what the agent did not read' },
    }),
    statuses: spec.nodes.map((n) => n.status),
    explain,
    sides,
    paneKey: SIDE_KEY,
    viewport: (side) => viewport(all, layout, check, side, previews, ghosts),
    aside: `${pageInfo(spec, check, sides, ghosts, meta.generatedAt)}<div id="panel" hidden></div>${all.nodes.map((n) => cardPanel(all, n, check, previews, sides, mark(drifted.get(n.id), ghostIds.has(n.id)))).join('')}`,
    width: layout.width,
    height: layout.height,
    extraDefs: CHANGE_ARROWS,
    ...(ghosts && { extraCss: DRIFT_CSS }),
  });
}
