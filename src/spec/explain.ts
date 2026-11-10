import { z } from 'zod';
import { flowShapeIssues, linkSchema, MAX_ITEMS, stepSchema, withStepTypes, type FlowInput, type FlowSpec, type FlowStep } from './flow.js';
import { ident, long, short } from './shared.js';

type Issue = (path: (string | number)[], message: string) => void;

const AREA = ['existing', 'outside'];
export const MAX_FLOWS = 5;
/** Step ids on the page are `flow:<flow id>/<step id>`; a box id can't start like that. */
export const FLOW_PREFIX = 'flow:';

const explainStep = stepSchema.extend({
  status: z.literal('existing'),
  box: ident().optional().describe('The id of the box this step happens in'),
});

/** A flow in an explain map: the flow spec's steps and links, nothing changed, each step optionally in a box. */
export const explainFlowSchema = z.strictObject({
  id: ident().refine((v) => !v.includes('/'), 'must not contain "/": step ids on the page are flow:<id>/<step id>'),
  title: short(),
  start: ident(),
  steps: z.array(explainStep).max(MAX_ITEMS, `at most ${MAX_ITEMS} steps; split the flow`),
  links: z.array(linkSchema.omit({ planned: true, removed: true })).max(MAX_ITEMS, `at most ${MAX_ITEMS} links; split the flow`),
  gaps: z.array(long()).optional(),
});

type ExplainFlowInput = z.infer<typeof explainFlowSchema>;

interface ExplainInput {
  kind: string;
  nodes: { id: string; status: string; path?: string; fields?: { change?: unknown }[] }[];
  omitted?: unknown;
  flows?: ExplainFlowInput[];
}

type ExplainStep = FlowStep & { box?: string };
/** A flow of an explain map as the renderers take it. */
export type ExplainFlow = Omit<FlowSpec, 'diagram' | 'kind' | 'steps'> & { id: string; steps: ExplainStep[] };

/** The flow as a summary flow with every step typed, for the code that draws flows. */
export const asFlowSpec = (f: ExplainFlow): FlowSpec => ({ ...f, diagram: 'flow', kind: 'summary' });

export const withTypes = (flows: ExplainFlowInput[] | undefined): ExplainFlow[] | undefined =>
  flows?.map((f) => ({ ...f, steps: withStepTypes(f.steps, f.links) }));

function flowIssues(spec: ExplainInput, flows: ExplainFlowInput[], issue: Issue): void {
  const boxes = new Set(spec.nodes.map((n) => n.id));
  const seen = new Set<string>();
  flows.forEach((flow, i) => {
    if (seen.has(flow.id)) issue(['flows', i, 'id'], `duplicate "${flow.id}"`);
    seen.add(flow.id);
    flow.steps.forEach((step, j) => {
      if (step.box !== undefined && !boxes.has(step.box)) issue(['flows', i, 'steps', j, 'box'], `flow "${flow.id}", step "${step.id}": unknown box "${step.box}"`);
    });
    flowShapeIssues({ ...flow, kind: 'summary' } as FlowInput, (path, message) => issue(['flows', i, ...path], message));
  });
}

/** An explain map draws code as it is: only `existing` and `outside` boxes, no change marks, no plan-or-summary extras; those two statuses and `flows` are for nothing else. */
export function explainIssues(spec: ExplainInput, issue: Issue): void {
  if (spec.kind !== 'explain') {
    spec.nodes.forEach((n, i) => {
      if (AREA.includes(n.status)) issue(['nodes', i, 'status'], `"${n.status}" is only for a map with "kind": "explain"`);
    });
    if (spec.flows !== undefined) issue(['flows'], 'only in a map with "kind": "explain"');
    return;
  }
  spec.nodes.forEach((n, i) => {
    if (!AREA.includes(n.status)) issue(['nodes', i, 'status'], `an explain map uses "existing" or "outside", not "${n.status}"`);
    if (n.status === 'existing' && n.path === undefined) issue(['nodes', i, 'path'], 'required for "existing": the file the box is in');
    if (spec.flows !== undefined && n.id.startsWith(FLOW_PREFIX)) issue(['nodes', i, 'id'], `"${FLOW_PREFIX}" is reserved for flow steps; pick another id`);
    n.fields?.forEach((f, j) => {
      if (f.change !== undefined) issue(['nodes', i, 'fields', j, 'change'], 'not in an explain map: nothing changed');
    });
  });
  if (spec.omitted !== undefined) issue(['omitted'], 'not in an explain map: there is no diff to leave files out of');
  if (spec.flows !== undefined) flowIssues(spec, spec.flows, issue);
}
