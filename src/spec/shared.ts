import { z } from 'zod';
import { hasHiddenChars } from '../render/strip.js';

export const SHORT = 200;
export const LONG = 2000;
/** Room for 1-3 plain sentences. */
const WHY = 400;
const PATH = 1000;
export const MAX_SPEC_BYTES = 2 * 1024 * 1024;

export const short = () => z.string().min(1).max(SHORT);
export const ident = () => short().refine((v) => !hasHiddenChars(v), 'must not contain control or invisible characters');
export const shortOpt = () => z.string().max(SHORT);
export const long = () => z.string().max(LONG);
export const pathStr = () => z.string().max(PATH);

const DRIFT_CAUSES = ['bug-found', 'wrong-assumption', 'user-asked', 'cleaner-way', 'out-of-scope', 'other'] as const;
export type DriftCause = (typeof DRIFT_CAUSES)[number];
export const driftBase = {
  cause: z.enum(DRIFT_CAUSES),
  why: z
    .string()
    .min(1)
    .max(WHY)
    .refine((v) => !hasHiddenChars(v), 'must not contain control or invisible characters')
    .describe('The detailed reason, 1-3 plain sentences: what you found, what you did instead, what it means for the user'),
};

/** `drift` explains a summary's differences from its plan: not allowed in a plan or an explain map, one entry per id. */
export function driftIssues(kind: 'plan' | 'summary' | 'explain', ids: readonly string[] | undefined, issue: (path: (string | number)[], message: string) => void): void {
  if (ids === undefined) return;
  if (kind === 'explain') return issue(['drift'], 'not in an explain map: there is no plan to differ from');
  if (kind === 'plan') return issue(['drift'], 'only in a summary: it says how the build differs from the plan');
  const seen = new Set<string>();
  ids.forEach((id, i) => {
    if (seen.has(id)) issue(['drift', i], `duplicate "${id}"`);
    seen.add(id);
  });
}

// Catches ~96% of 7-char short SHAs; rare hex words with a digit (e.g. "cafe123") are rejected too, by choice.
export function hashToken(label: string): string | undefined {
  return label
    .split(/[^A-Za-z0-9]+/)
    .find((t) => /^[0-9a-f]{7,}$/i.test(t) && /\d/.test(t) && /[a-f]/i.test(t));
}

// `list_projects()`, `values[]`, `{id}` and `>=` stay allowed: a reader still sees what they name.
export const CODE_PATTERNS = [
  { name: 'call', re: /[\w$.]\([^)]/ }, // a call with arguments
  { name: 'list', re: /\[[^\]]/ }, // an index or list literal
  { name: 'quote', re: /["`]|(?:^|\W)'[^']*'/ }, // a string literal
  { name: 'ellipsis', re: /\.\.\./ },
  { name: 'assignment', re: /(?:^|[^<>=!])=(?!=)/ },
];

/** A label that pastes code (`_l(["rag"])`) instead of naming the thing in words. */
export function codeLabelIssue(label: string, example: string): string | undefined {
  const hit = CODE_PATTERNS.some((p) => p.re.test(label));
  return hit ? `reads as code ("${label}"); name it in plain words (e.g. "${example}") and render again` : undefined;
}

export function labelIssues(label: string, noun: string, fileField: string, example: string): string[] {
  const issues: string[] = [];
  const code = codeLabelIssue(label, example);
  if (code) issues.push(code);
  const hash = hashToken(label);
  if (hash) {
    issues.push(
      `looks like a hash or file name ("${hash}"); label it by what it is (e.g. "${example}") and put the file in ${fileField}`,
    );
  }
  if (label.includes(' / ') || label.includes(' + ')) {
    const hint = noun === 'step' ? " (one action per step; no '+' or 'and')" : '';
    issues.push(`one ${noun} per entity; split "${label}" into separate ${noun}s${hint}`);
  }
  return issues;
}

export type ValidationResult<T> = { ok: true; spec: T } | { ok: false; errors: string[] };

export function formatPath(path: PropertyKey[]): string {
  if (path.length === 0) return '$';
  return path.reduce<string>((acc, seg) => {
    if (typeof seg === 'number') return `${acc}[${seg}]`;
    const s = String(seg);
    return acc ? `${acc}.${s}` : s;
  }, '');
}

const oneLine = (s: string): string =>
  s.split('\n').map((l) => l.trim()).join(' ');

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map(
    (issue) => `${formatPath(issue.path)}: ${oneLine(issue.message)}`,
  );
}
