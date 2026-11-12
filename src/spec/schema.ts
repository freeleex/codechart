import { z } from 'zod';
import { validateBusinessSpec, type BusinessSpec } from './business.js';
import { matchSchema, validateFlowSpec, type FlowSpec } from './flow.js';
import { validateReleaseSpec, type ReleaseSpec } from './release.js';
import { explainFlowSchema, explainIssues, MAX_FLOWS, withTypes, type ExplainFlow } from './explain.js';
import { codeLabelIssue, driftBase, driftIssues, formatIssues, ident, labelIssues, long, pathStr, short, shortOpt, type ValidationResult as Result } from './shared.js';

export const STATUSES = ['new', 'changed', 'removed', 'context', 'config', 'existing', 'outside'] as const;
export const NODE_KINDS = [
  'table', 'enum', 'model', 'service', 'endpoint', 'component', 'file', 'config', 'other',
] as const;
export const EDGE_KINDS = [
  'fk', 'calls', 'imports', 'reads', 'writes', 'renders', 'configures', 'other',
] as const;

const fieldSchema = z.strictObject({
  name: short(),
  type: shortOpt().optional(),
  note: long().optional(),
  change: z.enum(['added', 'removed', 'modified']).optional().describe('Plan or summary only'),
  was: shortOpt().optional().describe('The type before the change; only with change modified'),
});

const nodeSchema = z.strictObject({
  id: ident(),
  label: short(),
  kind: z.enum(NODE_KINDS).optional().describe('Defaults to file when path is set'),
  status: z.enum(STATUSES).describe('Plan or summary: new, changed, removed, config or context. Explain map: existing (in the area, path required) or outside (a neighbour the area talks to)'),
  layer: short(),
  summary: long().optional().describe('On every node: one or two plain sentences on what it does, its role in the system (not what changed)'),
  path: pathStr().optional(),
  match: matchSchema.describe('Text on exactly one line of path (plain substring, not a regex), checked at render').optional(),
  fields: z.array(fieldSchema).optional(),
  fieldsComplete: z.boolean().optional().describe('Required when fields is non-empty: true if every field is listed, false if only the fields you saw'),
  notes: z.array(long()).optional(),
});

const edgeSchema = z.strictObject({
  from: ident(),
  to: ident(),
  label: shortOpt().optional(),
  kind: z.enum(EDGE_KINDS).optional(),
  change: z.enum(['added', 'removed']).optional().describe('Plan only: a link the plan adds or drops between nodes that exist before and after'),
});

const driftSchema = z.strictObject({ node: ident(), ...driftBase });

const MAX_NODES = 500;
const EDGE_LABEL_EXAMPLE = 'additional_training (now a list)';
const MAX_EDGES = 1000;

const specSchema = z
  .strictObject({
    diagram: z.literal('map').optional(),
    title: short(),
    kind: z.enum(['plan', 'summary', 'explain']),
    rules: z.array(shortOpt()).optional(),
    nodes: z.array(nodeSchema).max(MAX_NODES, `at most ${MAX_NODES} nodes; split the map`),
    edges: z.array(edgeSchema).max(MAX_EDGES, `at most ${MAX_EDGES} edges; split the map`),
    gaps: z.array(long()).optional(),
    omitted: z.array(long()).optional(),
    drift: z.array(driftSchema).max(MAX_NODES).optional().describe('Summary only: how the build differs from the plan, one entry per node'),
    flows: z.array(explainFlowSchema).max(MAX_FLOWS, `at most ${MAX_FLOWS} flows; keep the main behaviours`).optional().describe('Explain map only: step-by-step behaviours of the area, shown on the page\'s Flows tab'),
  })
  // eslint-disable-next-line max-lines-per-function -- ratchet: one superRefine; barely over
  .superRefine((spec, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
    explainIssues(spec, issue);
    driftIssues(spec.kind, spec.drift?.map((d) => d.node), issue);
    const ids = new Set<string>();
    spec.nodes.forEach((node, i) => {
      if (ids.has(node.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', i, 'id'],
          message: `duplicate "${node.id}"`,
        });
      }
      ids.add(node.id);
      if (node.kind === undefined && node.path === undefined) {
        ctx.addIssue({ code: 'custom', path: ['nodes', i, 'kind'], message: 'required unless path is set (then it defaults to "file")' });
      }
      if (node.match !== undefined && node.path === undefined) {
        ctx.addIssue({ code: 'custom', path: ['nodes', i, 'match'], message: 'needs path set to the file the line is in' });
      }
      if (node.fields?.length && node.fieldsComplete === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', i, 'fieldsComplete'],
          message: 'required when fields are listed (true if you listed every field, false if only what you saw)',
        });
      }
      node.fields?.forEach((f, j) => {
        if (f.was !== undefined && f.change !== 'modified') {
          ctx.addIssue({ code: 'custom', path: ['nodes', i, 'fields', j, 'was'], message: 'only with "change": "modified"' });
        }
      });
      for (const message of labelIssues(
        node.label,
        'node',
        'path',
        'migration: add invoices',
      )) {
        ctx.addIssue({ code: 'custom', path: ['nodes', i, 'label'], message });
      }
    });
    const statusOf = new Map(spec.nodes.map((n) => [n.id, n.status]));
    spec.edges.forEach((edge, i) => {
      for (const end of ['from', 'to'] as const) {
        if (!ids.has(edge[end])) {
          ctx.addIssue({
            code: 'custom',
            path: ['edges', i, end],
            message: `unknown node "${edge[end]}"`,
          });
        }
      }
      const code = edge.label && codeLabelIssue(edge.label, EDGE_LABEL_EXAMPLE);
      if (code) ctx.addIssue({ code: 'custom', path: ['edges', i, 'label'], message: code });
      const ends = [statusOf.get(edge.from), statusOf.get(edge.to)];
      if (spec.kind === 'plan' && ends.includes('new') && ends.includes('removed')) {
        ctx.addIssue({ code: 'custom', path: ['edges', i], message: 'joins a new and a removed node, which never exist at the same time' });
      }
      if (edge.change === undefined) return;
      if (spec.kind !== 'plan') {
        ctx.addIssue({ code: 'custom', path: ['edges', i, 'change'], message: 'only in a plan' });
        return;
      }
      if (edge.change === 'added' && ends.includes('removed')) {
        ctx.addIssue({ code: 'custom', path: ['edges', i, 'change'], message: 'an edge to a removed node cannot be added' });
      }
      if (edge.change === 'removed' && ends.includes('new')) {
        ctx.addIssue({ code: 'custom', path: ['edges', i, 'change'], message: 'an edge to a new node cannot be removed; leave change out' });
      }
    });
  });

type ParsedSpec = z.infer<typeof specSchema>;
export type NodeKind = (typeof NODE_KINDS)[number];
export type SpecNode = ParsedSpec['nodes'][number] & { kind: NodeKind };
export type Spec = Omit<ParsedSpec, 'nodes' | 'flows'> & { nodes: SpecNode[]; flows?: ExplainFlow[] };
export type SpecEdge = Spec['edges'][number];
export type Field = NonNullable<SpecNode['fields']>[number];
export type Status = (typeof STATUSES)[number];

type ValidationResult = Result<Spec | FlowSpec>;

function isFlow(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false;
  const diagram = (input as { diagram?: unknown }).diagram;
  return diagram === 'flow' || (diagram === undefined && Object.hasOwn(input, 'steps'));
}

export function validateSpec(input: unknown): ValidationResult {
  if (isFlow(input)) return validateFlowSpec(input);
  const result = specSchema.safeParse(input);
  if (!result.success) return { ok: false, errors: formatIssues(result.error) };
  const nodes = result.data.nodes.map((n) => ({ ...n, kind: n.kind ?? 'file' }));
  const { flows: raw, ...rest } = result.data;
  const flows = withTypes(raw);
  return { ok: true, spec: { ...rest, nodes, ...(flows && { flows }) } };
}

/** Any kind of spec `render` takes: a release map, a business spec, a flow or a map. */
export function validateAnySpec(input: unknown): Result<Spec | FlowSpec | BusinessSpec | ReleaseSpec> {
  const diagram = typeof input === 'object' && input !== null ? (input as { diagram?: unknown }).diagram : undefined;
  if (diagram === 'business') return validateBusinessSpec(input);
  return diagram === 'release' ? validateReleaseSpec(input) : validateSpec(input);
}

export function specJsonSchema(): object {
  return z.toJSONSchema(specSchema, { io: 'input' });
}
