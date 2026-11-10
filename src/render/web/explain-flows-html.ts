import { stepRev } from '../../review/snapshot.js';
import type { Spec } from '../../spec/schema.js';
import type { FlowView, LaidOutCheck } from '../explain-flows.js';
import { FLOW_CSS, flowViewport, stepPanel } from '../flow/html.js';
import type { MapCheck } from '../check.js';
import { arrowMarker, esc } from './page.js';
import { COMPONENTS_VIEW } from './tools.js';

const viewId = (flowId: string): string => `flow:${flowId}`;

/** The flow rules, each under `.flowview` (picture) or `.steppanel` (side panel) so a map box and its panel keep their own look; marker rules stay global. */
function scopedFlowCss(): string {
  return FLOW_CSS.split('}')
    .filter((r) => r.trim())
    .map((rule) => {
      const [selectors, body] = rule.split('{') as [string, string];
      const scope = (sel: string) => (sel.startsWith('#') ? sel : sel.startsWith('aside ') ? `aside .steppanel ${sel.slice(6)}` : `.flowview ${sel}`);
      return `${selectors
        .split(',')
        .map((sel) => scope(sel.trim()))
        .join(',')}{${body}}`;
    })
    .join('\n');
}

export const VIEW_CSS = `
.defs{position:absolute;width:0;height:0}
#viewpanes{flex:1;min-width:0;display:flex}
.view{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}.view[hidden]{display:none}
.view>.pane-title{display:none}body.sbs .view>.pane-title{display:block}
body.sbs .view.flowview{border-left:1px solid var(--line)}
@media (max-width:900px){body.sbs #viewpanes{flex-direction:column}body.sbs .view.flowview{border-left:0;border-top:1px solid var(--line)}}
.pane-note{margin-left:10px;font-weight:400;text-transform:none}
.pane-note button{padding:0;font:inherit;color:var(--edge);background:none;border:0;cursor:pointer}.pane-note button:hover{text-decoration:underline}
.pane-note button:focus-visible{outline:2px solid var(--edge);outline-offset:2px}
.pane-dim .node:not(.lit),.pane-dim .edge:not(.lit){--dim:.25}
.node.linked .card{stroke-width:2.5}
.node.linked{filter:drop-shadow(0 0 6px color-mix(in srgb,var(--edge) 45%,transparent))}
.node.linked :is(.card,.shape){stroke-width:3}
#view-bar{background:var(--panel);border-bottom:1px solid var(--line)}
#view-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
#sbs{display:flex;align-items:center;gap:6px;padding:0 14px;font:11px system-ui,sans-serif;color:var(--muted);cursor:pointer}
#sbs input{appearance:none;flex:none;width:26px;height:14px;margin:0;position:relative;border-radius:7px;background:var(--line);cursor:pointer}
#sbs input::before{content:"";position:absolute;top:2px;left:2px;width:10px;height:10px;border-radius:50%;background:#fff;transition:left .12s}
#sbs input:checked{background:var(--edge)}#sbs input:checked::before{left:14px}
#sbs input:focus-visible{outline:2px solid var(--edge);outline-offset:2px}
#view-tabs{display:flex;flex-wrap:wrap;gap:20px;padding:0 14px}
#view-tabs button{padding:8px 2px 6px;font:600 13px system-ui,sans-serif;color:var(--muted);background:none;border:0;border-bottom:2px solid transparent;border-radius:0;cursor:pointer}
#view-tabs button:hover{color:var(--text)}
#view-tabs button[aria-selected="true"]{color:var(--text);border-bottom-color:var(--edge)}
#flow-tabs{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:6px 14px;background:var(--bg);border-top:1px solid var(--line)}#flow-tabs[hidden]{display:none}
#flow-tabs::before{content:"Flow:";margin-right:4px;font:11px system-ui,sans-serif;color:var(--muted)}
#flow-tabs button{padding:2px 10px;font:11px system-ui,sans-serif;color:var(--muted);background:none;border:1px solid transparent;border-radius:11px;cursor:pointer}
#flow-tabs button:hover{color:var(--text)}
#flow-tabs button[aria-selected="true"]{color:var(--text);background:var(--panel);border-color:var(--line)}
#view-bar button:focus-visible{outline:2px solid var(--edge);outline-offset:2px}
[data-only-view][hidden]{display:none!important}
#review{margin-left:auto}
aside .partof{margin:6px 0}
${scopedFlowCss()}
`;

/** The tab row with the Side by side switch at its right end, and under it one sub-tab per flow. */
export function viewTabs(flows: FlowView[]): string {
  const tab = (attr: string, label: string, selected: boolean) => `<button type="button" role="tab" ${attr} aria-selected="${selected}">${esc(label)}</button>`;
  return (
    `<div id="view-bar"><div id="view-row"><div id="view-tabs" role="tablist" aria-label="Views">${tab(`data-tab="${COMPONENTS_VIEW}"`, 'Components', true)}${tab('data-tab="flows"', `Flows (${flows.length})`, false)}</div>` +
    `<label id="sbs" title="Show Components and the selected flow next to each other"><input type="checkbox" id="sbs-toggle" role="switch">Side by side</label></div>` +
    `<div id="flow-tabs" role="tablist" aria-label="Flows" hidden>${flows.map((f) => tab(`data-view="${esc(viewId(f.id))}"`, f.title, false)).join('')}</div></div>`
  );
}

/** The canvas of each flow, ready for the page's views. */
export function flowSections(check: LaidOutCheck, changed: boolean): { id: string; title: string; cls: string; viewport: string; width: number; height: number }[] {
  return check.views.map((v) => {
    const revs = changed ? new Map(v.spec.steps.map((s) => [s.id, stepRev(v.spec, s, v.snippets)])) : undefined;
    return { id: viewId(v.id), title: v.title, cls: ' flowview', viewport: flowViewport(v.spec, v.layout, check, undefined, undefined, revs), width: v.layout.width, height: v.layout.height };
  });
}

/** Every step's side panel, with the box it happens in as a link back to the Components view. */
export function flowPanels(check: LaidOutCheck, spec: Spec): string {
  const labels = new Map(spec.nodes.map((n) => [n.id, n.label]));
  return check.views
    .map((v) => {
      const byId = new Map(v.spec.steps.map((s) => [s.id, s]));
      return v.spec.steps
        .map((s) => {
          const box = v.boxOf.get(s.id);
          const partOf = box === undefined ? '' : `<p class="partof">Part of: <button type="button" class="rel" data-goto="${esc(box)}">${esc(labels.get(box) ?? box)}</button></p>`;
          return stepPanel(v.spec, s, v.snippets, byId, check, { partOf, plain: true });
        })
        .join('');
    })
    .join('');
}

/** For a box's panel: each flow with a step in it, linking to the first such step; empty when no flow goes through it. */
export function flowsThrough(boxId: string, check: MapCheck | LaidOutCheck | undefined): string {
  const hits = (check && 'views' in check ? check.views : []).flatMap((v) => {
    const step = v.spec.steps.find((s) => v.boxOf.get(s.id) === boxId);
    return step ? [{ title: v.title, id: step.id }] : [];
  });
  if (!hits.length) return '';
  return `<h3>Flows through this box</h3><ul>${hits.map((h) => `<li><button type="button" class="rel" data-goto="${esc(h.id)}">${esc(h.title)}</button></li>`).join('')}</ul>`;
}

/** Arrowheads the flow views use, defined once for every view. */
export const FLOW_DEFS = arrowMarker('arrow-planned');
