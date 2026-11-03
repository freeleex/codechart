import { z } from 'zod';
import { hasHiddenChars } from '../render/strip.js';
import { formatIssues, ident, labelIssues, long, pathStr, short, SHORT, shortOpt, type ValidationResult } from './shared.js';

const STEP_TYPES = ['step', 'decision', 'end'] as const;
type StepType = (typeof STEP_TYPES)[number];
export const STEP_STATUSES = ['existing', 'new', 'changed', 'planned', 'removed'] as const;

const SOURCE_RE = /^[^\s:\u0000-\u001f\u007f-\u009f]+(:\d+(-\d+)?)?$/;
const sourceSchema = pathStr().regex(SOURCE_RE, 'must be path:line or path:start-end, or a path with match');
const hasLine = (source: string) => source.includes(':');
const ANCHOR = '(path:line, path:start-end, or a path with match)';
export const matchSchema = z
  .string()
  .trim()
  .min(1, 'must not be blank')
  .max(SHORT)
  .refine((v) => !hasHiddenChars(v.replaceAll('\t', ' ')), 'must be one line without control or invisible characters (tabs are fine); quote a single line')
  .describe('Text on the anchored line (plain substring, not a regex); source is then the path only');

const stepSchema = z.strictObject({
  id: ident(),
  label: short(),
  type: z.enum(STEP_TYPES).optional().describe('Inferred when left out: 0 outgoing links end, 1 step, 2 or more decision'),
  status: z.enum(STEP_STATUSES),
  source: sourceSchema.optional(),
  match: matchSchema.optional(),
});

const linkSchema = z.strictObject({
  from: ident(),
  to: ident(),
  label: short().optional(),
  source: sourceSchema.optional(),
  match: matchSchema.optional(),
  planned: z.boolean().optional(),
  removed: z.boolean().optional().describe('Plan only: a link that exists now and the plan drops, between steps that stay'),
});

const MAX_ITEMS = 200;

type Anchored = { source?: string; match?: string };

function anchorIssues(a: Anchored): [field: 'source' | 'match', message: string][] {
  if (a.match !== undefined && !a.source) return [['match', 'needs source set to the file path']];
  if (!a.source || !SOURCE_RE.test(a.source)) return [];
  if (a.match !== undefined && hasLine(a.source)) return [['source', 'with match, give only the path (no :line)']];
  if (a.match === undefined && !hasLine(a.source)) return [['source', 'needs a line (path:line or path:start-end) or a match']];
  return [];
}

type PlannedEnds = { from: string; to: string; planned?: boolean };

/** A link is planned when marked so or when either end is a planned step. */
export function isPlannedLink(spec: { steps: readonly { id: string; status: string }[] }, link: PlannedEnds): boolean {
  const planned = (id: string) => spec.steps.some((s) => s.id === id && s.status === 'planned');
  return link.planned === true || planned(link.from) || planned(link.to);
}

type RemovedEnds = { from: string; to: string; removed?: boolean };
type StatusOf = { steps: readonly { id: string; status: string }[] };

/** A link the plan drops: marked so, or with a removed step at either end. */
export function isRemovedLink(spec: StatusOf, link: RemovedEnds): boolean {
  const removed = (id: string) => spec.steps.some((s) => s.id === id && s.status === 'removed');
  return link.removed === true || removed(link.from) || removed(link.to);
}

const inferType = (outgoing: number): StepType => (outgoing === 0 ? 'end' : outgoing >= 2 ? 'decision' : 'step');

/** A step's shape follows the flow after the plan; a removed step keeps the links it has now. */
function outgoingLinks<L extends RemovedEnds>(spec: StatusOf, links: readonly L[]): Map<string, L[]> {
  const removedStep = new Set(spec.steps.filter((s) => s.status === 'removed').map((s) => s.id));
  const out = new Map<string, L[]>();
  for (const l of links) {
    if (!removedStep.has(l.from) && isRemovedLink(spec, l)) continue;
    out.set(l.from, [...(out.get(l.from) ?? []), l]);
  }
  return out;
}

function outgoingCounts(spec: StatusOf, links: readonly RemovedEnds[]): Map<string, number> {
  return new Map([...outgoingLinks(spec, links)].map(([id, ls]) => [id, ls.length]));
}

const flowSchema = z
  .strictObject({
    diagram: z.literal('flow').optional().describe('Optional: a spec with steps is a flow'),
    kind: z.enum(['plan', 'summary']),
    title: short(),
    rules: z.array(shortOpt()).optional(),
    start: ident(),
    steps: z.array(stepSchema).max(MAX_ITEMS, `at most ${MAX_ITEMS} steps; split the flow`),
    links: z.array(linkSchema).max(MAX_ITEMS, `at most ${MAX_ITEMS} links; split the flow`),
    gaps: z.array(long()).optional(),
  })
  .superRefine((spec, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });

    const counts = outgoingCounts(spec, spec.links);
    const live = outgoingLinks(spec, spec.links.map((l, i) => ({ ...l, i })));
    const typeOf = (step: { id: string; type?: StepType }) => step.type ?? inferType(counts.get(step.id) ?? 0);
    const byId = new Map<string, z.infer<typeof stepSchema>>();
    spec.steps.forEach((step, i) => {
      if (byId.has(step.id)) issue(['steps', i, 'id'], `duplicate "${step.id}"`);
      byId.set(step.id, step);
      for (const m of labelIssues(step.label, 'step', 'source', 'migration: add invoices')) {
        issue(['steps', i, 'label'], m);
      }
      if (spec.kind === 'summary' && step.status === 'planned') {
        issue(['steps', i, 'status'], 'a summary describes code that exists; "planned" is for plans');
      }
      if (spec.kind === 'summary' && step.status === 'removed') {
        issue(['steps', i, 'status'], 'a summary describes code that exists; "removed" is for plans');
      }
      if (spec.kind === 'plan' && (step.status === 'new' || step.status === 'changed')) {
        issue(['steps', i, 'status'], `a plan uses only "existing", "planned" or "removed" steps, not "${step.status}"`);
      }
      if (step.status !== 'planned' && !step.source) {
        issue(['steps', i, 'source'], `required for a non-planned step ${ANCHOR}`);
      }
      for (const [field, m] of anchorIssues(step)) issue(['steps', i, field], m);
    });

    let refsOk = byId.has(spec.start);
    if (!refsOk) issue(['start'], `unknown step "${spec.start}"`);
    else if (byId.get(spec.start)!.status === 'removed') issue(['start'], 'the start step cannot be removed; start where the flow begins after the plan');
    const brandNew = (id: string) => byId.get(id)?.status === 'planned' && !byId.get(id)?.source;
    const removedStep = (id: string) => byId.get(id)?.status === 'removed';

    const outgoing = new Map<string, number[]>();
    spec.links.forEach((link, i) => {
      for (const end of ['from', 'to'] as const) {
        if (byId.has(link[end])) continue;
        refsOk = false;
        issue(['links', i, end], `unknown step "${link[end]}"`);
      }
      const list = outgoing.get(link.from) ?? [];
      list.push(i);
      outgoing.set(link.from, list);

      if (spec.kind === 'summary' && link.planned) {
        issue(['links', i, 'planned'], 'a summary describes code that exists; "planned" is for plans');
      }
      if (spec.kind === 'summary' && link.removed) {
        issue(['links', i, 'removed'], 'a summary describes code that exists; "removed" is for plans');
      }
      if (link.removed && link.planned) issue(['links', i, 'removed'], 'a link is either planned or removed, not both');
      const ends = [link.from, link.to];
      if (ends.some(brandNew) && (link.removed || ends.some(removedStep))) {
        issue(['links', i], 'joins a planned step not in the code yet to something the plan removes; they never exist at the same time');
      } else if (link.planned && ends.some(removedStep)) {
        issue(['links', i, 'planned'], 'a link to a removed step cannot be planned');
      }
      const from = byId.get(link.from);
      const leavesDecision = from !== undefined && typeOf(from) === 'decision';
      if (leavesDecision && !isPlannedLink(spec, link) && !link.source) {
        issue(['links', i, 'source'], `required for a non-planned branch leaving a decision ${ANCHOR}`);
      }
      for (const [field, m] of anchorIssues(link)) issue(['links', i, field], m);
    });

    spec.steps.forEach((step, i) => {
      // Shape checks follow the flow after the plan; a decision labels every branch, removed ones too.
      const links = (live.get(step.id) ?? []).map((l) => l.i);
      if (step.type === undefined && step.label.trim().endsWith('?') && links.length < 2) {
        issue(['steps', i, 'type'], `label ends in "?", so this is a decision: it needs at least 2 outgoing links, has ${links.length}`);
        return;
      }
      const type = typeOf(step);
      if (type === 'end' && links.length > 0) {
        issue(['steps', i, 'type'], `an end has no outgoing links, has ${links.length}`);
      }
      if (type === 'step' && links.length > 1) {
        issue(['steps', i, 'type'], `has ${links.length} outgoing links; make it a decision with labelled branches`);
      }
      if (type !== 'decision') return;
      if (links.length < 2) {
        issue(['steps', i, 'id'], `decision "${step.id}" needs at least 2 outgoing links, has ${links.length}`);
      }
      for (const li of outgoing.get(step.id) ?? []) {
        if (!spec.links[li]!.label) issue(['links', li, 'label'], 'required on a link leaving a decision');
      }
    });

    if (refsOk) {
      const reached = new Set([spec.start]);
      for (const id of reached) {
        for (const li of outgoing.get(id) ?? []) {
          if (!isRemovedLink(spec, spec.links[li]!)) reached.add(spec.links[li]!.to);
        }
      }
      spec.steps.forEach((step, i) => {
        if (step.status !== 'removed' && !reached.has(step.id)) issue(['steps', i], 'not reachable from start');
      });
    }
  });

type ParsedFlow = z.infer<typeof flowSchema>;
export type FlowStep = ParsedFlow['steps'][number] & { type: StepType };
export type FlowLink = ParsedFlow['links'][number];
export type FlowSpec = Omit<ParsedFlow, 'diagram' | 'steps'> & { diagram: 'flow'; steps: FlowStep[] };

export function validateFlowSpec(input: unknown): ValidationResult<FlowSpec> {
  const result = flowSchema.safeParse(input);
  if (!result.success) return { ok: false, errors: formatIssues(result.error) };
  const counts = outgoingCounts(result.data, result.data.links);
  const steps = result.data.steps.map((s) => ({ ...s, type: s.type ?? inferType(counts.get(s.id) ?? 0) }));
  return { ok: true, spec: { ...result.data, diagram: 'flow', steps } };
}

export function flowJsonSchema(): object {
  return z.toJSONSchema(flowSchema, { io: 'input' });
}
