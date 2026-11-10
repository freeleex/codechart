import { stepRev } from '../../review/snapshot.js';
import { isPlannedLink, isRemovedLink, type FlowLink, type FlowSpec, type FlowStep } from '../../spec/flow.js';
import type { CheckSummary } from '../terminal/check-lines.js';
import { flagMark, flagTitle, mismatchNote } from '../web/check-html.js';
import { DRIFT_CSS, driftInfo, driftMark, driftSection, itemsById, type Ghosts } from '../web/drift-html.js';
import type { DriftItem } from '../drift.js';
import { edgeEnds, infoButton, gapsHtml, pageInfoSection, renderDiagramPage, renderEdgeSvg, type EdgeEnds } from '../web/diagram.js';
import { arrowMarker, CHANGE_ARROWS, esc, num, type HtmlMeta } from '../web/page.js';
import type { Side } from '../web/states.js';
import { panelShell, relationsHtml, relationsOf, panelTitle, tickSvg } from '../web/tools.js';
import { FLOW_SIDE_KEY, hasFlowNowAfter, isAltered, linkOn, linkTone, stepOn } from './states.js';
import type { FlowSnippets, Snippet } from './anchors.js';
import { BADGE_HEIGHT, LINE_HEIGHT, type FlowLayout, type FlowLayoutEdge, type FlowLayoutNode } from './layout.js';

export const FLOW_CSS = `
.node .shape{fill:var(--card);stroke:var(--muted);stroke-width:1.2}
.node .label{font-weight:500;text-anchor:middle}
.node .badge{text-anchor:middle;font-weight:600}
.node.selected .shape{stroke-width:3}
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

/** How far left of a diamond's left point its tickbox is centred. */
const DECISION_TICK_GAP = 10;

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
function renderStep(step: FlowStep, b: FlowLayoutNode, flag: string, side: Side | undefined, { drift, ghost = false, rev }: { drift?: DriftItem<FlowStep>; ghost?: boolean; rev?: string } = {}): string {
  const flagged = flag !== '';
  const cx = num(b.x + b.w / 2);
  const content = b.lines.length * LINE_HEIGHT + (b.badge ? BADGE_HEIGHT : 0);
  let y = b.y + (b.h - content) / 2;
  let text = '';
  // In Now, a step the plan alters is today's code that will change.
  const changing = side === 'now' && isAltered(step);
  const status = changing ? 'changed' : step.status;
  if (b.badge) {
    text += `<text class="badge" x="${cx}" y="${num(y + 9)}">${esc(ghost ? 'not built' : changing ? 'will change' : b.badge)}</text>`;
    y += BADGE_HEIGHT;
  }
  for (const l of b.lines) {
    text += `<text class="label" x="${cx}" y="${num(y + 11)}">${esc(l)}</text>`;
    y += LINE_HEIGHT;
  }
  return (
    `<g class="node type-${step.type} status-${status}${ghost ? ' ghost' : ''}" data-id="${esc(step.id)}" data-label="${esc(step.label)}" data-status="${step.status}"${rev ? ` data-rev="${rev}"` : ''} tabindex="0" role="button" aria-label="${esc(`${step.label} (${step.status} ${step.type}${flagged ? ", doesn't match the code" : ''}${drift ? `, ${drift.kind === 'missing' ? 'in the plan, not built' : 'differs from the plan'}` : ''})`)}">` +
    flag +
    shape(step, b) +
    text +
    (ghost ? '' : step.type === 'decision' ? tickSvg(b.x - DECISION_TICK_GAP, b.y + b.h / 2) : tickSvg(b.x, b.y)) +
    (flagged ? flagMark(b.x + b.w, b.y) : '') +
    (drift ? driftMark(drift, b.x + b.w, b.y + b.h + 8) : '') +
    `</g>`
  );
}

function renderLink(link: FlowLink, e: FlowLayoutEdge, tone: 'planned' | 'removed' | undefined, ends: EdgeEnds, ghost = false): string {
  return renderEdgeSvg({
    ends,
    points: e.points,
    marker: `arrow${tone ? `-${tone}` : ''}`,
    cls: `edge${tone === 'planned' ? ' planned' : tone === 'removed' ? ' edge-removed' : ''}${ghost ? ' ghost' : ''}`,
    label: link.label,
    labelAt: e.labelAt,
    lift: 7,
  });
}

/** A path that wraps after `/`, not mid-name. */
export const pathHtml = (p: string) => esc(p).replaceAll('/', '/<wbr>');

const TAB = 4;

/** The leading whitespace stays real text (copy keeps it); its width also sets a hanging indent so a wrapped line sits under the code. */
const splitIndent = (code: string): [number, string] => {
  const rest = code.trimStart();
  const lead = code.slice(0, code.length - rest.length);
  const width = [...lead].reduce((w, c) => w + (c === '\t' ? TAB : 1), 0);
  return [width, lead ? `<span class="ind">${lead}</span>${rest}` : rest];
};

/** One code row; the number gets its own grid column so a wrapped line hangs under the code. A diff row (with a sign) is one flex row: number, sign and code columns, tinted as a whole. */
export const codeRow = (n: number | undefined, code: string, cls?: string, sign?: string) => {
  const cl = (c?: string) => (c ? ` class="${c}"` : '');
  const [indent, text] = n === undefined ? [0, code] : splitIndent(code);
  const pad = indent ? ` style="padding-left:${indent}ch;text-indent:-${indent}ch"` : '';
  if (sign === undefined) return `<span class="ln">${n ?? ''}</span><span${cl(cls)}${pad}>${text}</span>`;
  return `<span class="${cls} dr"><span class="ln">${n ?? ''}</span><span class="sg">${sign}</span><span class="cd"${pad}>${text}</span></span>`;
};

export function snippetHtml(s: Snippet): string {
  const code = s.lines.map((l, i) => codeRow(s.startLine + i, esc(l))).join('\n');
  const end = Number(s.source.match(/-(\d+)$/)?.[1] ?? s.startLine);
  const total = end - s.startLine + 1;
  const more = total > s.lines.length ? `<p class="more">first ${s.lines.length} of ${total} lines</p>` : '';
  return `<div class="path">${pathHtml(s.source)}</div><pre class="snippet"><code>${code}</code></pre>${more}`;
}

const tag = (status: string) => `<span class="tag tag-${esc(status)}">${esc(status)}</span>`;

/** `partOf`: html for the line saying which box of an explain map the step happens in. `plain`: an explain map's step: no status tag, and the panel's body in a `.steppanel` the flow's panel rules are scoped to. */
export function stepPanel(spec: FlowSpec, step: FlowStep, snippets: FlowSnippets, byId: Map<string, FlowStep>, check: CheckSummary | undefined, extra: { mark?: { drift: DriftItem<FlowStep>; ghost: boolean }; partOf?: string; plain?: boolean } = {}): string {
  const { mark, partOf = '', plain = false } = extra;
  const ghost = mark?.ghost ?? false;
  let out = panelTitle(step.id, step.label, !ghost);
  out += `<div class="status">${ghost ? '<span class="tag">not built</span>' : plain ? '' : `${tag(step.status)} `}${esc(step.type)}</div>${partOf}`;
  out += mismatchNote(check, step.id);
  const snip = snippets.steps.get(step.id);
  if (step.status === 'planned') {
    out += `<p class="planned-note">${snip ? 'Planned change to the code below.' : 'Planned: not in the code yet.'}</p>`;
  }
  if (step.status === 'removed') out += '<p class="removed-note">Removed by the plan.</p>';
  if (snip) out += snippetHtml(snip);
  else if (step.source) out += `<div class="path">${esc(step.source)}</div>`;
  out += driftSection(mark?.drift, ghost);

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
  const relations = relationsHtml(relationsOf(step.id, links, (id) => byId.get(id)?.label ?? id));
  return `<template class="card-panel" data-for="${esc(step.id)}">${panelShell(plain ? `<div class="steppanel">${out}</div>` : out, relations)}</template>`;
}

function pageInfo(spec: FlowSpec, anyPlanned: boolean, sides: boolean, check: CheckSummary | undefined, ghosts: Ghosts<FlowStep, FlowLink> | undefined, now: Date): string {
  const planned = anyPlanned ? '<p class="planned-note">Dashed steps and arrows are planned: not in the code yet.</p>' : '';
  const removed =
    spec.steps.some((s) => s.status === 'removed') || spec.links.some((l) => l.removed)
      ? '<p class="removed-note">Red steps and arrows are removed by the plan.</p>'
      : '';
  const hint = 'Click a step for its status, source and code. Scroll to zoom, drag to pan';
  return pageInfoSection(hint, sides, check, driftInfo(ghosts?.drift, now), planned, removed, gapsHtml('Gaps', spec.gaps, 'gap'));
}

const mark = (drift: DriftItem<FlowStep> | undefined, ghost: boolean) => (drift ? { drift, ghost } : undefined);

/** The spec with the plan's missing steps and their links added, to lay out and draw. */
export const withGhosts = (spec: FlowSpec, ghosts: Ghosts<FlowStep, FlowLink> | undefined): FlowSpec =>
  ghosts ? { ...spec, steps: [...spec.steps, ...ghosts.nodes], links: [...spec.links, ...ghosts.links] } : spec;

/** Without `side`: the whole plan or summary in one picture. `spec` is laid out with its ghosts. */
export function flowViewport(spec: FlowSpec, layout: FlowLayout, check: CheckSummary | undefined, side?: Side, ghosts?: Ghosts<FlowStep, FlowLink>, revs?: Map<string, string>): string {
  const drifted = itemsById(ghosts?.drift);
  const ghostIds = new Set(ghosts?.nodes.map((g) => g.id));
  const ghostLinks = new Set(ghosts?.links);
  const byId = new Map(spec.steps.map((s) => [s.id, s]));
  const boxes = new Map(layout.nodes.map((n) => [n.id, n]));
  const edges = spec.links
    .map((l, i) => {
      if (!layout.edges[i] || (side && !linkOn(side, spec, l, byId))) return '';
      const ghost = ghostLinks.has(l);
      return renderLink(l, layout.edges[i], ghost ? undefined : linkTone(side, spec, l), edgeEnds(l.from, l.to, (id) => byId.get(id)?.label ?? id), ghost);
    })
    .join('');
  const nodes = spec.steps
    .filter((s) => !side || stepOn(side, s))
    .map((s) => {
      const b = boxes.get(s.id);
      return b ? renderStep(s, b, flagTitle(check, s.id), side, { drift: drifted.get(s.id), ghost: ghostIds.has(s.id), rev: revs?.get(s.id) }) : '';
    })
    .join('');
  return `${edges}${nodes}`;
}

/** `ghosts`: a summary's drift from its plan; `layout` is of `withGhosts(spec, ghosts)`. */
export function renderFlowHtml(spec: FlowSpec, layout: FlowLayout, snippets: FlowSnippets, meta: HtmlMeta, check?: CheckSummary, ghosts?: Ghosts<FlowStep, FlowLink>): string {
  const all = withGhosts(spec, ghosts);
  const byId = new Map(all.steps.map((s) => [s.id, s]));
  const drifted = itemsById(ghosts?.drift);
  const ghostIds = new Set(ghosts?.nodes.map((g) => g.id));
  const drift = Boolean(ghosts?.drift.items.length);
  const sides = hasFlowNowAfter(spec);
  const revs = meta.change ? new Map(spec.steps.map((s) => [s.id, stepRev(spec, s, snippets)])) : undefined;
  const anyPlanned = spec.links.some((l) => isPlannedLink(spec, l)) || spec.steps.some((s) => s.status === 'planned');
  return renderDiagramPage({
    title: spec.title,
    meta,
    check,
    drift: ghosts?.drift,
    infoButton: infoButton(check, Boolean(spec.gaps?.length || drift), {
      mismatch: {
        label: drift ? 'Check / differences / gaps' : 'Check / gaps',
        title: "Show what doesn't match the code, how the build differs from the plan and what the agent did not check",
      },
      info: drift
        ? { label: 'Differences / gaps', title: 'Show how the build differs from the plan and what the agent did not check' }
        : { label: 'Gaps', title: 'Show what the agent did not check' },
    }),
    statuses: spec.steps.map((s) => s.status),
    sides,
    paneKey: FLOW_SIDE_KEY,
    viewport: (side) => flowViewport(all, layout, check, side, ghosts, revs),
    aside: `${pageInfo(spec, anyPlanned, sides, check, ghosts, meta.generatedAt)}<div id="panel" hidden></div>${all.steps.map((s) => stepPanel(all, s, snippets, byId, check, { mark: mark(drifted.get(s.id), ghostIds.has(s.id)) })).join('')}`,
    width: layout.width,
    height: layout.height,
    extraCss: ghosts ? FLOW_CSS + DRIFT_CSS : FLOW_CSS,
    extraDefs: arrowMarker('arrow-planned') + CHANGE_ARROWS,
  });
}
