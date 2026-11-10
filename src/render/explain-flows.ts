import { asFlowSpec, FLOW_PREFIX, type ExplainFlow } from '../spec/explain.js';
import type { FlowSpec } from '../spec/flow.js';
import type { Spec } from '../spec/schema.js';
import { checkMapNodes, type MapCheck } from './check.js';
import { anchorContext, scanFlowAnchors, type AnchorFailure, type FlowSnippets } from './flow/anchors.js';
import { layoutFlow, type FlowLayout } from './flow/layout.js';
import { stepLabel } from './flow/tree.js';
import type { Mismatch } from './terminal/check-lines.js';

/** The page's id for a step. A flow id has no `/` (the spec refuses it) and a box id doesn't start with `flow:`, so no two steps or boxes share one. */
const stepKey = (flowId: string, stepId: string): string => `${FLOW_PREFIX}${flowId}/${stepId}`;

/** A flow as the page draws it: step ids namespaced with the flow's, so they never clash with box ids or another flow's steps. */
export interface FlowView {
  id: string;
  title: string;
  spec: FlowSpec;
  snippets: FlowSnippets;
  /** Page id of a step -> the box it happens in. */
  boxOf: Map<string, string>;
}

export interface ExplainCheck extends MapCheck {
  /** Anchored steps among `checked`. */
  steps: number;
  views: FlowView[];
}

function namespaced(flow: ExplainFlow): FlowSpec {
  const key = (id: string) => stepKey(flow.id, id);
  const spec = asFlowSpec(flow);
  return {
    ...spec,
    start: key(flow.start),
    steps: flow.steps.map((s) => ({ ...s, id: key(s.id) })),
    links: flow.links.map((l) => ({ ...l, from: key(l.from), to: key(l.to) })),
  };
}

function shortOf(f: AnchorFailure): string {
  if (f.missing) return 'file missing';
  if (f.field === 'match') return f.error.includes(' lines of ') ? 'match on several lines' : 'match not found';
  return /not found \(/.test(f.error) ? 'line not found' : 'file unreadable';
}

/** A step's anchor that did not resolve, or a branch's, which is put on the step it leaves. */
function mismatchOf(flow: FlowView, f: AnchorFailure): Mismatch {
  const link = f.group === 'links' ? flow.spec.links[f.at]! : undefined;
  const step = flow.spec.steps.find((s) => s.id === (link ? link.from : flow.spec.steps[f.at]!.id))!;
  const target = link ? flow.spec.steps.find((s) => s.id === link.to) : undefined;
  const detail = target ? `the branch to "${target.label}": ${f.error}` : f.error;
  return { id: step.id, label: `${flow.title}: ${stepLabel(step)}`, short: shortOf(f), detail };
}

/** The map's gaps, then each flow's, led by the flow's title. */
export const flowGaps = (spec: Spec): string[] => [...(spec.gaps ?? []), ...(spec.flows ?? []).flatMap((f) => (f.gaps ?? []).map((g) => `${f.title}: ${g}`))];

interface Options {
  at?: string;
  cwd?: string;
}

/** The boxes' check plus every flow's anchors: what counts as checked is boxes and anchored steps; a step whose anchor fails is flagged like a box. */
export function checkExplain(spec: Spec, root: string, opts: Options = {}): ExplainCheck {
  const check = checkMapNodes(spec, root, opts);
  const ctx = anchorContext(root, opts.at, opts.cwd);
  const mismatches = [...check.mismatches];
  let steps = 0;
  const views = (spec.flows ?? []).map((flow): FlowView => {
    const ns = namespaced(flow);
    const scan = scanFlowAnchors(ns, ctx);
    const view: FlowView = {
      id: flow.id,
      title: flow.title,
      spec: ns,
      snippets: scan.snippets,
      boxOf: new Map(flow.steps.flatMap((s) => (s.box === undefined ? [] : [[stepKey(flow.id, s.id), s.box] as const]))),
    };
    steps += ns.steps.filter((s) => s.source !== undefined).length;
    mismatches.push(...scan.failures.map((f) => mismatchOf(view, f)));
    return view;
  });
  return { ...check, checked: check.checked + steps, steps, mismatches, views };
}

interface LaidOutView extends FlowView {
  layout: FlowLayout;
}

/** The check with each flow laid out, which the page needs and the terminal does not. */
export interface LaidOutCheck extends ExplainCheck {
  views: LaidOutView[];
}

export async function layOutFlows(check: ExplainCheck): Promise<LaidOutCheck> {
  return { ...check, views: await Promise.all(check.views.map(async (v) => ({ ...v, layout: await layoutFlow(v.spec) }))) };
}
