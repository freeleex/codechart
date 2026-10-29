import { z } from 'zod';
import { validateFlowSpec, type FlowSpec } from './flow.js';
import { formatIssues, ident, labelIssues, long, pathStr, short, shortOpt, type ValidationResult as Result } from './shared.js';

export const STATUSES = ['new', 'changed', 'removed', 'context', 'config'] as const;
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
  change: z.enum(['added', 'removed', 'modified']).optional(),
});

const nodeSchema = z.strictObject({
  id: ident(),
  label: short(),
  kind: z.enum(NODE_KINDS).optional().describe('Defaults to file when path is set'),
  status: z.enum(STATUSES),
  layer: short(),
  summary: long().optional(),
  path: pathStr().optional(),
  fields: z.array(fieldSchema).optional(),
  fieldsComplete: z.boolean().optional().describe('Required when fields is non-empty: true if every field is listed, false if only the fields you saw'),
  notes: z.array(long()).optional(),
});

const edgeSchema = z.strictObject({
  from: ident(),
  to: ident(),
  label: shortOpt().optional(),
  kind: z.enum(EDGE_KINDS).optional(),
});

const MAX_NODES = 500;
const MAX_EDGES = 1000;

const specSchema = z
  .strictObject({
    diagram: z.literal('map').optional(),
    title: short(),
    kind: z.enum(['plan', 'summary']),
    rules: z.array(shortOpt()).optional(),
    nodes: z.array(nodeSchema).max(MAX_NODES, `at most ${MAX_NODES} nodes; split the map`),
    edges: z.array(edgeSchema).max(MAX_EDGES, `at most ${MAX_EDGES} edges; split the map`),
    gaps: z.array(long()).optional(),
    omitted: z.array(long()).optional(),
  })
  .superRefine((spec, ctx) => {
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
      if (node.fields?.length && node.fieldsComplete === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', i, 'fieldsComplete'],
          message: 'required when fields are listed (true if you listed every field, false if only what you saw)',
        });
      }
      for (const message of labelIssues(
        node.label,
        'node',
        'path',
        'migration: add invoices',
      )) {
        ctx.addIssue({ code: 'custom', path: ['nodes', i, 'label'], message });
      }
    });
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
    });
  });

type ParsedSpec = z.infer<typeof specSchema>;
export type NodeKind = (typeof NODE_KINDS)[number];
export type SpecNode = ParsedSpec['nodes'][number] & { kind: NodeKind };
export type Spec = Omit<ParsedSpec, 'nodes'> & { nodes: SpecNode[] };
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
  return { ok: true, spec: { ...result.data, nodes } };
}

export function specJsonSchema(): object {
  return z.toJSONSchema(specSchema, { io: 'input' });
}
