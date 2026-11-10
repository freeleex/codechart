import { z } from 'zod';
import { dataSchema, itemIssues, itemTexts, journeySchema, ruleSchema, text, type Issue } from './business.js';
import { plainTextIssues } from './plain-text.js';
import { formatIssues, formatPath, ident, short, type ValidationResult } from './shared.js';

const MAX_SECTIONS = 12;
const MAX_JOURNEYS = 4;
const MAX_RULES = 6;
const MAX_DATA = 4;

const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const version = () => z.string().regex(VERSION, 'a version such as 0.8.0 or v1.2.0-beta.1');
const isDay = (d: string): boolean => {
  const at = new Date(`${d}T00:00:00Z`);
  return DAY.test(d) && !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === d;
};

// A release map is not reviewed: no tech links, no trust tag, no questions.
const OMIT = { links: true, evidence: true } as const;

const sectionSchema = z.strictObject({
  id: ident(),
  title: short(),
  change: z.enum(['new', 'changed', 'fixed']).describe('new: a feature that did not exist; changed: an existing one works differently; fixed: something that was wrong now works'),
  summary: text().describe('One or two plain sentences: what this means for people using the product'),
  pr: z.number().int().positive().optional().describe('Pull request number; not shown on the page'),
  journeys: z.array(journeySchema.omit(OMIT)).max(MAX_JOURNEYS).default([]),
  rules: z.array(ruleSchema.omit(OMIT)).max(MAX_RULES).default([]),
  data: z.array(dataSchema.omit(OMIT)).max(MAX_DATA).default([]),
});

const releaseSchema = z
  .strictObject({
    diagram: z.literal('release'),
    title: short(),
    version: version(),
    date: z.string().refine(isDay, 'a real date as YYYY-MM-DD'),
    since: version().optional().describe('The previous version'),
    summary: text().describe("One or two plain sentences: what's new in this release"),
    sections: z.array(sectionSchema).min(1).max(MAX_SECTIONS, `at most ${MAX_SECTIONS} sections; group the changes into fewer features`),
  })
  .superRefine((spec, ctx) => {
    const issue: Issue = (path, message) => ctx.addIssue({ code: 'custom', path, message });
    const seen = new Set<string>();
    spec.sections.forEach((s, i) => {
      if (seen.has(s.id)) issue(['sections', i, 'id'], `duplicate "${s.id}"`);
      seen.add(s.id);
    });
    spec.sections.forEach((s, i) => itemIssues(s, issue, seen, ['sections', i]));
    for (const t of releaseTexts(spec)) {
      for (const message of plainTextIssues(t.text)) issue(t.path, message);
    }
  });

export type ReleaseSpec = z.infer<typeof releaseSchema>;

/** Every string a reader sees in a release map, with its path: the ones the plain-words check applies to. */
function releaseTexts(spec: ReleaseSpec): { path: (string | number)[]; text: string }[] {
  return [
    { path: ['title'], text: spec.title },
    { path: ['summary'], text: spec.summary },
    ...spec.sections.flatMap((s, i) => [{ path: ['sections', i, 'title'], text: s.title }, { path: ['sections', i, 'summary'], text: s.summary }, ...itemTexts(s, ['sections', i])]),
  ];
}

const CHECKED_ONLY = 'a release map only holds facts checked in the code, PR text or diff: ask the developer about anything uncertain, or leave it out';
const ITEM_GROUPS = ['journeys', 'rules', 'data'] as const;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Questions and evidence belong to reviewed maps: name them instead of the generic "unrecognized key". */
function reviewIssues(input: unknown): string[] {
  const out: string[] = [];
  const sections = isObj(input) && Array.isArray(input.sections) ? input.sections : [];
  sections.forEach((s, i) => {
    if (!isObj(s)) return;
    if ('questions' in s) out.push(`${formatPath(['sections', i, 'questions'])}: not allowed; ${CHECKED_ONLY}`);
    for (const group of ITEM_GROUPS) {
      const items = Array.isArray(s[group]) ? s[group] : [];
      items.forEach((item, j) => {
        if (isObj(item) && 'evidence' in item) out.push(`${formatPath(['sections', i, group, j, 'evidence'])}: not allowed; ${CHECKED_ONLY}`);
      });
    }
  });
  return out;
}

export function validateReleaseSpec(input: unknown): ValidationResult<ReleaseSpec> {
  const refused = reviewIssues(input);
  if (refused.length) return { ok: false, errors: refused };
  const result = releaseSchema.safeParse(input);
  return result.success ? { ok: true, spec: result.data } : { ok: false, errors: formatIssues(result.error) };
}

export function releaseSpecJsonSchema(): object {
  return z.toJSONSchema(releaseSchema, { io: 'input' });
}
