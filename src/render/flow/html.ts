import { isPlannedLink, isRemovedLink, type FlowLink, type FlowSpec, type FlowStep } from '../../spec/flow.js';
import type { CheckSummary } from '../terminal/check-lines.js';
import { flagMark, flagTitle, mismatchNote } from '../web/check-html.js';
import { edgeEnds, infoButton, gapsHtml, pageInfoSection, renderDiagramPage, renderEdgeSvg, type EdgeEnds } from '../web/diagram.js';
import { arrowMarker, CHANGE_ARROWS, esc, num, type HtmlMeta } from '../web/page.js';
import type { Side } from '../web/states.js';
import { relationsHtml, relationsOf, tickRow, tickSvg } from '../web/tools.js';
import { FLOW_SIDE_KEY, hasFlowNowAfter, isAltered, linkOn, linkTone, stepOn } from './states.js';
import type { FlowSnippets, Snippet } from './anchors.js';
import { BADGE_HEIGHT, LINE_HEIGHT, type FlowLayout, type FlowLayoutEdge, type FlowLayoutNode } from './layout.js';

const FLOW_CSS = `
.node .shape{fill:var(--card);stroke:var(--muted);stroke-width:1.2}
.node .label{font-weight:500;text-anchor:middle}
.node .badge{text-anchor:middle;font-weight:600}
.node.selected .shape{stroke-width:2.5}
.node:focus-visible .shape{stroke:var(--edge);stroke-width:3.5}
.status-new .shape{stroke:var(--new)}
.status-changed .shape{stroke:var(--chg)}
.status-removed .shape{stroke:var(--rem)}
aside .tag-removed{color:var(--rem)}aside .removed-note{color:var(--rem);font-style:italic;margin:6px 0}
.status-planned .shape{stroke:var(--cfg);stroke-dasharray:6 4;fill:var(--bg)}.status-planned .badge{fill:var(--cfg-t)}
.edge.planned path{stroke:var(--cfg);stroke-dasharray:6 4}#arrow-planned path{fill:var(--cfg)}.edge.planned text{fill:var(--cfg-t)}
aside .status{color:var(--muted);margin-bottom:4px}
aside .tag{font-size:10px;text-transform:uppercase;border:1px solid currentColor;border-radius:8px;padding:0 5px}
aside .tag-new{color:var(--new-t)}aside .tag-changed{color:var(--chg-t)}aside .tag-planned{color:var(--cfg-t);border-style:dashed}
aside .planned-note{color:var(--cfg-t);font-style:italic;margin:6px 0}
aside .more{color:var(--muted);font-size:11px;margin:0}
aside .branches{padding-left:0;list-style:none}
aside .branches li{margin:0 0 10px}
`;

function shape(step: FlowStep, b: FlowLayoutNode): string {
  if (step.type === 'decision') {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const pts = [
      [cx, b.y],
      [b.x + b.w, cy],
      [cx, b.y + b.h],
      [b.x, cy],
    ];
    return `<polygon class="shape" points="${pts.map(([x, y]) => `${num(x!)},${num(y!)}`).join(' ')}"/>`;
  }
  const rx = step.type === 'end' ? b.h / 2 : 4;
  return `<rect class="shape" x="${num(b.x)}" y="${num(b.y)}" width="${num(b.w)}" height="${num(b.h)}" rx="${num(rx)}"/>`;
}

/** `flag`: the hover title of a step that doesn't match the code, else empty. */
function renderStep(step: FlowStep, b: FlowLayoutNode, flag: string, side?: Side): string {
  const flagged = flag !== '';
  const cx = num(b.x + b.w / 2);
  const content = b.lines.length * LINE_HEIGHT + (b.badge ? BADGE_HEIGHT : 0);
  let y = b.y + (b.h - content) / 2;
  let text = '';
  // In Now, a step the plan alters is today's code that will change.
  const changing = side === 'now' && isAltered(step);
  const status = changing ? 'changed' : step.status;
  if (b.badge) {
    text += `<text class="badge" x="${cx}" y="${num(y + 9)}">${esc(changing ? 'will change' : b.badge)}</text>`;
    y += BADGE_HEIGHT;
  }
  for (const l of b.lines) {
    text += `<text class="label" x="${cx}" y="${num(y + 11)}">${esc(l)}</text>`;
    y += LINE_HEIGHT;
  }
  return (
    `<g class="node type-${step.type} status-${status}" data-id="${esc(step.id)}" data-status="${step.status}" tabindex="0" role="button" aria-label="${esc(`${step.label} (${step.status} ${step.type}${flagged ? ", doesn't match the code" : ''})`)}">` +
    flag +
    shape(step, b) +
    text +
    tickSvg(b.x, b.y) +
    (flagged ? flagMark(b.x + b.w, b.y) : '') +
    `</g>`
  );
}

function renderLink(link: FlowLink, e: FlowLayoutEdge, tone: 'planned' | 'removed' | undefined, ends: EdgeEnds): string {
  return renderEdgeSvg({
    ends,
    points: e.points,
    marker: `arrow${tone ? `-${tone}` : ''}`,
    cls: `edge${tone === 'planned' ? ' planned' : tone === 'removed' ? ' edge-removed' : ''}`,
    label: link.label,
    labelAt: e.labelAt,
    lift: 7,
  });
}

/** A path that wraps after `/`, not mid-name. */
export const pathHtml = (p: string) => esc(p).replaceAll('/', '/<wbr>');

const TAB = 4;

/** Leading whitespace as a column count, so it can be padding: a wrapped line then hangs under its own indent. */
const splitIndent = (code: string): [number, string] => {
  const rest = code.trimStart();
  const lead = code.slice(0, code.length - rest.length);
  return [[...lead].reduce((w, c) => w + (c === '\t' ? TAB : 1), 0), rest];
};

/** One code row; the number gets its own grid column so a wrapped line hangs under the code, and a diff sign its own column inside the code cell. */
export const codeRow = (n: number | undefined, code: string, cls?: string, extra = '', sign?: string) => {
  const both = (c?: string) => (c || extra ? ` class="${[c, extra].filter(Boolean).join(' ')}"` : '');
  const [indent, text] = n === undefined ? [0, code] : splitIndent(code);
  const pad = indent ? ` style="padding-left:${indent}ch"` : '';
  const ln = `<span${both('ln')}>${n ?? ''}</span>`;
  if (sign === undefined) return `${ln}<span${both(cls)}${pad}>${text}</span>`;
  return `${ln}<span${both(`${cls} dr`)}><span class="sg">${sign}</span><span class="cd"${pad}>${text}</span></span>`;
};

export function snippetHtml(s: Snippet): string {
  const code = s.lines.map((l, i) => codeRow(s.startLine + i, esc(l))).join('\n');
  const end = Number(s.source.match(/-(\d+)$/)?.[1] ?? s.startLine);
  const total = end - s.startLine + 1;
  const more = total > s.lines.length ? `<p class="more">first ${s.lines.length} of ${total} lines</p>` : '';
  return `<div class="path">${pathHtml(s.source)}</div><pre class="snippet"><code>${code}</code></pre>${more}`;
}

const tag = (status: string) => `<span class="tag tag-${esc(status)}">${esc(status)}</span>`;

function stepPanel(spec: FlowSpec, step: FlowStep, snippets: FlowSnippets, byId: Map<string, FlowStep>, check: CheckSummary | undefined): string {
  let out = `<h2>${esc(step.label)}</h2>${tickRow(step.id)}`;
  out += `<div class="status">${tag(step.status)} ${esc(step.type)}</div>`;
  out += mismatchNote(check, step.id);
  const snip = snippets.steps.get(step.id);
  if (step.status === 'planned') {
    out += `<p class="planned-note">${snip ? 'Planned change to the code below.' : 'Planned: not in the code yet.'}</p>`;
  }
  if (step.status === 'removed') out += '<p class="removed-note">Removed by the plan.</p>';
  if (snip) out += snippetHtml(snip);
  else if (step.source) out += `<div class="path">${esc(step.source)}</div>`;

  const next = spec.links.map((l, i) => ({ l, i })).filter(({ l }) => l.from === step.id);
  if (next.length) {
    const items = next.map(({ l, i }) => {
      const target = byId.get(l.to)?.label ?? l.to;
      let li = `${l.label ? `<b>${esc(l.label)}</b> → ` : '→ '}${esc(target)}`;
      if (isRemovedLink(spec, l)) li += ` ${tag('removed')}`;
      else if (isPlannedLink(spec, l)) li += ` ${tag('planned')}`;
      const s = snippets.links[i];
      if (s) li += snippetHtml(s);
      else if (l.source) li += `<div class="path">${esc(l.source)}</div>`;
      return `<li>${li}</li>`;
    });
    out += `<h3>Next</h3><ul class="branches">${items.join('')}</ul>`;
  }
  const links = spec.links.map((l) => ({ from: l.from, to: l.to, label: l.label }));
  out += relationsHtml(relationsOf(step.id, links, (id) => byId.get(id)?.label ?? id));
  return `<template class="card-panel" data-for="${esc(step.id)}">${out}</template>`;
}

function pageInfo(spec: FlowSpec, anyPlanned: boolean, sides: boolean, check: CheckSummary | undefined): string {
  const planned = anyPlanned ? '<p class="planned-note">Dashed steps and arrows are planned: not in the code yet.</p>' : '';
  const removed =
    spec.steps.some((s) => s.status === 'removed') || spec.links.some((l) => l.removed)
      ? '<p class="removed-note">Red steps and arrows are removed by the plan.</p>'
      : '';
  const hint = 'Click a step for its status, source and code. Scroll to zoom, drag to pan';
  return pageInfoSection(hint, sides, check, planned, removed, gapsHtml('Gaps', spec.gaps));
}

/** Without `side`: the whole plan or summary in one picture. */
function viewport(spec: FlowSpec, layout: FlowLayout, check: CheckSummary | undefined, side?: Side): string {
  const byId = new Map(spec.steps.map((s) => [s.id, s]));
  const boxes = new Map(layout.nodes.map((n) => [n.id, n]));
  const edges = spec.links
    .map((l, i) => {
      if (!layout.edges[i] || (side && !linkOn(side, spec, l, byId))) return '';
      return renderLink(l, layout.edges[i], linkTone(side, spec, l), edgeEnds(l.from, l.to, (id) => byId.get(id)?.label ?? id));
    })
    .join('');
  const nodes = spec.steps
    .filter((s) => !side || stepOn(side, s))
    .map((s) => {
      const b = boxes.get(s.id);
      return b ? renderStep(s, b, flagTitle(check, s.id), side) : '';
    })
    .join('');
  return `${edges}${nodes}`;
}

export function renderFlowHtml(spec: FlowSpec, layout: FlowLayout, snippets: FlowSnippets, meta: HtmlMeta, check?: CheckSummary): string {
  const byId = new Map(spec.steps.map((s) => [s.id, s]));
  const sides = hasFlowNowAfter(spec);
  const anyPlanned = spec.links.some((l) => isPlannedLink(spec, l)) || spec.steps.some((s) => s.status === 'planned');
  return renderDiagramPage({
    title: spec.title,
    meta,
    check,
    infoButton: infoButton(check, Boolean(spec.gaps?.length), {
      mismatch: { label: 'Check / gaps', title: "Show what doesn't match the code and what the agent did not check" },
      info: { label: 'Gaps', title: 'Show what the agent did not check' },
    }),
    statuses: spec.steps.map((s) => s.status),
    sides,
    paneKey: FLOW_SIDE_KEY,
    viewport: (side) => viewport(spec, layout, check, side),
    aside: `${pageInfo(spec, anyPlanned, sides, check)}<div id="panel" hidden></div>${spec.steps.map((s) => stepPanel(spec, s, snippets, byId, check)).join('')}`,
    width: layout.width,
    height: layout.height,
    extraCss: FLOW_CSS,
    extraDefs: arrowMarker('arrow-planned') + CHANGE_ARROWS,
  });
}
