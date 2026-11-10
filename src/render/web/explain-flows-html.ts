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
.view{flex:1;min-width:0;min-height:0;display:flex}.view[hidden]{display:none}
#view-bar{background:var(--panel);border-bottom:1px solid var(--line)}
#view-tabs,#flow-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:6px 14px}#flow-tabs{padding-top:0}#flow-tabs[hidden]{display:none}
#view-bar button{padding:3px 12px;font:12px system-ui,sans-serif;color:var(--muted);background:none;border:1px solid transparent;border-radius:12px;cursor:pointer}
#view-bar button:hover{color:var(--text)}
#view-bar button[aria-selected="true"]{color:var(--text);font-weight:600;border-color:var(--edge)}
#flow-tabs button{font-size:11px}
[data-only-view][hidden]{display:none!important}
#review{margin-left:auto}
aside .partof{margin:6px 0}
${scopedFlowCss()}
`;

/** The tab row, and under it one sub-tab per flow. */
export function viewTabs(flows: FlowView[]): string {
  const tab = (attr: string, label: string, selected: boolean) => `<button type="button" role="tab" ${attr} aria-selected="${selected}">${esc(label)}</button>`;
  return (
    `<div id="view-bar"><div id="view-tabs" role="tablist" aria-label="Views">${tab(`data-tab="${COMPONENTS_VIEW}"`, 'Components', true)}${tab('data-tab="flows"', `Flows (${flows.length})`, false)}</div>` +
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
