import { z } from 'zod';
import { hasHiddenChars } from '../render/strip.js';
import { codeLabelIssue, driftBase, driftIssues, formatIssues, ident, labelIssues, long, pathStr, short, SHORT, shortOpt, type ValidationResult } from './shared.js';

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

export const stepSchema = z.strictObject({
  id: ident(),
  label: short(),
  type: z.enum(STEP_TYPES).optional().describe('Inferred when left out: 0 outgoing links end, 1 step, 2 or more decision'),
  status: z.enum(STEP_STATUSES),
  source: sourceSchema.optional(),
  match: matchSchema.optional(),
});

export const linkSchema = z.strictObject({
  from: ident(),
  to: ident(),
  label: short().optional(),
  source: sourceSchema.optional(),
  match: matchSchema.optional(),
  planned: z.boolean().optional(),
  removed: z.boolean().optional().describe('Plan only: a link that exists now and the plan drops, between steps that stay'),
});

export const MAX_ITEMS = 200;

const driftSchema = z.strictObject({ step: ident(), ...driftBase });

type StepInput = z.infer<typeof stepSchema>;
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

const flowObject = z.strictObject({
  diagram: z.literal('flow').optional().describe('Optional: a spec with steps is a flow'),
  kind: z.enum(['plan', 'summary']),
  title: short(),
  rules: z.array(shortOpt()).optional(),
  start: ident(),
  steps: z.array(stepSchema).max(MAX_ITEMS, `at most ${MAX_ITEMS} steps; split the flow`),
  links: z.array(linkSchema).max(MAX_ITEMS, `at most ${MAX_ITEMS} links; split the flow`),
  gaps: z.array(long()).optional(),
  drift: z.array(driftSchema).max(MAX_ITEMS).optional().describe('Summary only: how the build differs from the plan, one entry per step'),
});

export type FlowInput = z.infer<typeof flowObject>;
type LinkInput = z.infer<typeof linkSchema>;
type Issue = (path: (string | number)[], message: string) => void;

/** What the validators share: step lookup, link indexes and the shape rules that depend on both. */
function flowFacts(spec: FlowInput) {
  const counts = outgoingCounts(spec, spec.links);
  const live = outgoingLinks(spec, spec.links.map((l, i) => ({ ...l, i })));
  const byId = new Map(spec.steps.map((s) => [s.id, s]));
  const brandNew = (id: string) => byId.get(id)?.status === 'planned' && !byId.get(id)?.source;
  const removedStep = (id: string) => byId.get(id)?.status === 'removed';
  // A step that branches today keeps labelled, anchored branches even if the plan leaves it one exit.
  const existsNow = (link: LinkInput) => link.planned !== true && !brandNew(link.from) && !brandNew(link.to);
  const nowOut = new Map<string, number[]>();
  const outgoing = new Map<string, number[]>();
  spec.links.forEach((link, i) => {
    outgoing.set(link.from, [...(outgoing.get(link.from) ?? []), i]);
    if (existsNow(link)) nowOut.set(link.from, [...(nowOut.get(link.from) ?? []), i]);
  });
  return {
    byId,
    live,
    nowOut,
    outgoing,
    brandNew,
    removedStep,
    existsNow,
    typeOf: (step: { id: string; type?: StepType }) => step.type ?? inferType(counts.get(step.id) ?? 0),
    branchesNow: (id: string) => spec.kind === 'plan' && (nowOut.get(id)?.length ?? 0) >= 2 && (live.get(id)?.length ?? 0) < 2,
  };
}
type Facts = ReturnType<typeof flowFacts>;

const summaryOnlyExisting = (word: 'planned' | 'removed') => `a summary describes code that exists; "${word}" is for plans`;

function stepStatusIssue(kind: FlowInput['kind'], status: StepInput['status']): string | undefined {
  if (kind === 'summary') return status === 'planned' || status === 'removed' ? summaryOnlyExisting(status) : undefined;
  if (status === 'new' || status === 'changed') return `a plan uses only "existing", "planned" or "removed" steps, not "${status}"`;
  return undefined;
}

function stepIssues(spec: FlowInput, issue: Issue): void {
  const seen = new Set<string>();
  spec.steps.forEach((step, i) => {
    if (seen.has(step.id)) issue(['steps', i, 'id'], `duplicate "${step.id}"`);
    seen.add(step.id);
    for (const m of labelIssues(step.label, 'step', 'source', 'migration: add invoices')) issue(['steps', i, 'label'], m);
    const status = stepStatusIssue(spec.kind, step.status);
    if (status) issue(['steps', i, 'status'], status);
    if (step.status !== 'planned' && !step.source) issue(['steps', i, 'source'], `required for a non-planned step ${ANCHOR}`);
    for (const [field, m] of anchorIssues(step)) issue(['steps', i, field], m);
  });
}

function startIssues(spec: FlowInput, facts: Facts, issue: Issue): void {
  const start = facts.byId.get(spec.start);
  if (!start) issue(['start'], `unknown step "${spec.start}"`);
  else if (start.status === 'removed') issue(['start'], 'the start step cannot be removed; start where the flow begins after the plan');
}

/** Problems with a link's own flags, as [path below the link, message]. */
function linkFlagIssues(spec: FlowInput, link: LinkInput, facts: Facts): [path: string[], message: string][] {
  const found: [string[], string][] = [];
  if (spec.kind === 'summary') {
    for (const word of ['planned', 'removed'] as const) if (link[word]) found.push([[word], summaryOnlyExisting(word)]);
  }
  if (link.removed && link.planned) found.push([['removed'], 'a link is either planned or removed, not both']);
  const ends = [link.from, link.to];
  if (ends.some(facts.brandNew) && (link.removed || ends.some(facts.removedStep))) {
    found.push([[], 'joins a planned step not in the code yet to something the plan removes; they never exist at the same time']);
  } else if (link.planned && ends.some(facts.removedStep)) {
    found.push([['planned'], 'a link to a removed step cannot be planned']);
  }
  return found;
}

function leavesDecision(facts: Facts, link: LinkInput): boolean {
  const from = facts.byId.get(link.from);
  return from !== undefined && (facts.typeOf(from) === 'decision' || (facts.branchesNow(from.id) && facts.existsNow(link)));
}

function linkIssues(spec: FlowInput, facts: Facts, issue: Issue): void {
  spec.links.forEach((link, i) => {
    for (const end of ['from', 'to'] as const) {
      if (!facts.byId.has(link[end])) issue(['links', i, end], `unknown step "${link[end]}"`);
    }
    for (const [path, m] of linkFlagIssues(spec, link, facts)) issue(['links', i, ...path], m);
    const code = link.label && codeLabelIssue(link.label, 'no coupon');
    if (code) issue(['links', i, 'label'], code);
    if (leavesDecision(facts, link) && !isPlannedLink(spec, link) && !link.source) {
      issue(['links', i, 'source'], `required for a non-planned branch leaving a decision ${ANCHOR}`);
    }
    for (const [field, m] of anchorIssues(link)) issue(['links', i, field], m);
  });
}

/** Shape checks follow the flow after the plan; a decision labels every branch, removed ones too. */
function shapeIssues(spec: FlowInput, facts: Facts, issue: Issue): void {
  const needLabels = (linkIdx: number[]) => {
    for (const li of linkIdx) if (!spec.links[li]!.label) issue(['links', li, 'label'], 'required on a link leaving a decision');
  };
  spec.steps.forEach((step, i) => {
    const count = (facts.live.get(step.id) ?? []).length;
    if (step.type === undefined && step.label.trim().endsWith('?') && count < 2 && !facts.branchesNow(step.id)) {
      issue(['steps', i, 'type'], `label ends in "?", so this is a decision: it needs at least 2 outgoing links, has ${count}`);
      return;
    }
    const type = facts.typeOf(step);
    if (type === 'end' && count > 0) issue(['steps', i, 'type'], `an end has no outgoing links, has ${count}`);
    if (type === 'step' && count > 1) issue(['steps', i, 'type'], `has ${count} outgoing links; make it a decision with labelled branches`);
    if (type !== 'decision') {
      if (facts.branchesNow(step.id)) needLabels(facts.nowOut.get(step.id) ?? []);
      return;
    }
    if (count < 2) issue(['steps', i, 'id'], `decision "${step.id}" needs at least 2 outgoing links, has ${count}`);
    needLabels(facts.outgoing.get(step.id) ?? []);
  });
}

function reachabilityIssues(spec: FlowInput, facts: Facts, issue: Issue): void {
  const refsOk = facts.byId.has(spec.start) && spec.links.every((l) => facts.byId.has(l.from) && facts.byId.has(l.to));
  if (!refsOk) return;
  const reached = new Set([spec.start]);
  for (const id of reached) {
    for (const li of facts.outgoing.get(id) ?? []) {
      if (!isRemovedLink(spec, spec.links[li]!)) reached.add(spec.links[li]!.to);
    }
  }
  spec.steps.forEach((step, i) => {
    if (step.status !== 'removed' && !reached.has(step.id)) issue(['steps', i], 'not reachable from start');
  });
}

/** The flow's shape rules: steps, start, links, branches and reachability. */
export function flowShapeIssues(spec: FlowInput, issue: Issue): void {
  const facts = flowFacts(spec);
  stepIssues(spec, issue);
  startIssues(spec, facts, issue);
  linkIssues(spec, facts, issue);
  shapeIssues(spec, facts, issue);
  reachabilityIssues(spec, facts, issue);
}

const flowSchema = flowObject.superRefine((spec, ctx) => {
  const issue: Issue = (path, message) => ctx.addIssue({ code: 'custom', path, message });
  driftIssues(spec.kind, spec.drift?.map((d) => d.step), issue);
  flowShapeIssues(spec, issue);
});

type ParsedFlow = z.infer<typeof flowSchema>;
export type FlowStep = ParsedFlow['steps'][number] & { type: StepType };
export type FlowLink = ParsedFlow['links'][number];
export type FlowSpec = Omit<ParsedFlow, 'diagram' | 'steps'> & { diagram: 'flow'; steps: FlowStep[] };

/** Steps with the type each one infers from its links when left out. */
export function withStepTypes<S extends { id: string; status: string; type?: StepType }>(steps: S[], links: RemovedEnds[]): (S & { type: StepType })[] {
  const counts = outgoingCounts({ steps }, links);
  return steps.map((s) => ({ ...s, type: s.type ?? inferType(counts.get(s.id) ?? 0) }));
}

export function validateFlowSpec(input: unknown): ValidationResult<FlowSpec> {
  const result = flowSchema.safeParse(input);
  if (!result.success) return { ok: false, errors: formatIssues(result.error) };
  const steps = withStepTypes(result.data.steps, result.data.links);
  return { ok: true, spec: { ...result.data, diagram: 'flow', steps } };
}

export function flowJsonSchema(): object {
  return z.toJSONSchema(flowSchema, { io: 'input' });
}
