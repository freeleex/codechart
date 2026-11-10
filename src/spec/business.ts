import { z } from 'zod';
import { plainTextIssues } from './plain-text.js';
import { formatIssues, ident, long, short, type ValidationResult } from './shared.js';

const MAX_JOURNEYS = 8;
const MAX_RULES = 12;
const MAX_DATA = 8;
const MAX_STEPS = 10;
const MAX_EXCEPTIONS = 5;
const MAX_QUESTIONS = 7;
const MAX_LINKS = 12;

export const text = () => long().min(1);
const evidence = () => z.enum(['checked', 'reading']).describe('checked: you read the code that does this; reading: you worked it out from names and structure');
const links = () => z.array(ident()).min(1, 'name the tech map boxes this comes from').max(MAX_LINKS).describe('Ids of the boxes on the tech map this comes from');

const stepSchema = z.strictObject({
  text: short(),
  change: z.enum(['new', 'changed', 'removed']).optional().describe('removed only in now, new only in after'),
});

export const journeySchema = z.strictObject({
  id: ident(),
  name: short(),
  who: short().optional(),
  now: z.array(stepSchema).max(MAX_STEPS),
  after: z.array(stepSchema).max(MAX_STEPS),
  links: links(),
  evidence: evidence(),
});

export const ruleSchema = z.strictObject({
  id: ident(),
  name: short(),
  before: text().optional().describe('Left out for a new rule'),
  after: text(),
  exceptions: z.array(text()).max(MAX_EXCEPTIONS).optional(),
  links: links(),
  evidence: evidence(),
});

export const dataSchema = z.strictObject({
  id: ident(),
  name: short(),
  what: text().describe('What the business now keeps'),
  why: text(),
  links: links(),
  evidence: evidence(),
});

const QUESTION_KINDS = ['unhandled', 'number', 'conflict', 'assumption', 'other'] as const;

export const questionSchema = z.strictObject({
  id: ident(),
  about: ident().describe('Id of the journey, rule or saved data it is about'),
  text: text(),
  kind: z.enum(QUESTION_KINDS),
});

export type Issue = (path: (string | number)[], message: string) => void;
type Path = (string | number)[];

const businessSchema = z
  .strictObject({
    diagram: z.literal('business'),
    title: short(),
    summary: text().describe('One or two plain sentences: what changes for the business'),
    map: ident().describe('File name slug of the tech map this describes; left out: the newest one on the branch').optional(),
    journeys: z.array(journeySchema).max(MAX_JOURNEYS).default([]),
    rules: z.array(ruleSchema).max(MAX_RULES).default([]),
    data: z.array(dataSchema).max(MAX_DATA).default([]),
    questions: z.array(questionSchema).max(MAX_QUESTIONS).default([]),
  })
  .superRefine((spec, ctx) => {
    const issue: Issue = (path, message) => ctx.addIssue({ code: 'custom', path, message });
    if (!spec.journeys.length && !spec.rules.length && !spec.data.length) issue([], 'needs at least one journey, rule or saved data item');
    itemIssues(spec, issue, new Set());
    for (const t of businessTexts(spec)) {
      for (const message of plainTextIssues(t.text)) issue(t.path, message);
    }
  });

export type BusinessSpec = z.infer<typeof businessSchema>;

type JourneyItem = Omit<z.infer<typeof journeySchema>, 'links'>;
type RuleItem = Omit<z.infer<typeof ruleSchema>, 'links'>;
type DataItem = Omit<z.infer<typeof dataSchema>, 'links'>;

/** The journeys, rules, saved data and questions of a business map, or of one section of a release map. */
export interface Items {
  journeys: JourneyItem[];
  rules: RuleItem[];
  data: DataItem[];
  questions: z.infer<typeof questionSchema>[];
}

/** Duplicate ids (against `seen`, which the caller may share with more groups), questions about unknown items and steps on the wrong side. */
export function itemIssues(items: Items, issue: Issue, seen: Set<string>, at: Path = []): void {
  const groups = [['journeys', items.journeys], ['rules', items.rules], ['data', items.data], ['questions', items.questions]] as const;
  for (const [group, list] of groups) {
    list.forEach((item, i) => {
      if (seen.has(item.id)) issue([...at, group, i, 'id'], `duplicate "${item.id}"`);
      seen.add(item.id);
    });
  }
  const about = new Set([...items.journeys, ...items.rules, ...items.data].map((x) => x.id));
  items.questions.forEach((q, i) => {
    if (!about.has(q.about)) issue([...at, 'questions', i, 'about'], `unknown journey, rule or saved data item "${q.about}"`);
  });
  items.journeys.forEach((j, i) => stepIssues(j, [...at, 'journeys', i], issue));
}

function stepIssues(journey: JourneyItem, at: Path, issue: Issue): void {
  if (!journey.now.length && !journey.after.length) issue([...at, 'after'], 'needs steps in now or after');
  journey.now.forEach((s, j) => {
    if (s.change === 'new') issue([...at, 'now', j, 'change'], '"new" belongs in after: a step that exists now is not new');
  });
  journey.after.forEach((s, j) => {
    if (s.change === 'removed') issue([...at, 'after', j, 'change'], '"removed" belongs in now: a removed step is not in after');
  });
}

/** Every string a reader sees in a business map, with its path: the ones the plain-words check applies to. */
export function businessTexts(spec: BusinessSpec): { path: Path; text: string }[] {
  return [{ path: ['title'], text: spec.title }, { path: ['summary'], text: spec.summary }, ...itemTexts(spec)];
}

/** The reader-visible strings of the items, with their paths under `at`. */
export function itemTexts(items: Items, at: Path = []): { path: Path; text: string }[] {
  const out: { path: Path; text: string }[] = [];
  const add = (path: Path, value: string | undefined) => value !== undefined && out.push({ path: [...at, ...path], text: value });
  items.journeys.forEach((j, i) => {
    add(['journeys', i, 'name'], j.name);
    add(['journeys', i, 'who'], j.who);
    for (const side of ['now', 'after'] as const) j[side].forEach((s, k) => add(['journeys', i, side, k, 'text'], s.text));
  });
  items.rules.forEach((r, i) => {
    add(['rules', i, 'name'], r.name);
    add(['rules', i, 'before'], r.before);
    add(['rules', i, 'after'], r.after);
    r.exceptions?.forEach((e, k) => add(['rules', i, 'exceptions', k], e));
  });
  items.data.forEach((d, i) => {
    add(['data', i, 'name'], d.name);
    add(['data', i, 'what'], d.what);
    add(['data', i, 'why'], d.why);
  });
  items.questions.forEach((q, i) => add(['questions', i, 'text'], q.text));
  return out;
}

export function validateBusinessSpec(input: unknown): ValidationResult<BusinessSpec> {
  const result = businessSchema.safeParse(input);
  return result.success ? { ok: true, spec: result.data } : { ok: false, errors: formatIssues(result.error) };
}

export function businessSpecJsonSchema(): object {
  return z.toJSONSchema(businessSchema, { io: 'input' });
}
