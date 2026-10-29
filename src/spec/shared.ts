import { z } from 'zod';
import { hasHiddenChars } from '../render/strip.js';

export const SHORT = 200;
const LONG = 2000;
const PATH = 1000;
export const MAX_SPEC_BYTES = 2 * 1024 * 1024;

export const short = () => z.string().min(1).max(SHORT);
export const ident = () => short().refine((v) => !hasHiddenChars(v), 'must not contain control or invisible characters');
export const shortOpt = () => z.string().max(SHORT);
export const long = () => z.string().max(LONG);
export const pathStr = () => z.string().max(PATH);

// Catches ~96% of 7-char short SHAs; rare hex words with a digit (e.g. "cafe123") are rejected too, by choice.
function hashToken(label: string): string | undefined {
  return label
    .split(/[^A-Za-z0-9]+/)
    .find((t) => /^[0-9a-f]{7,}$/i.test(t) && /\d/.test(t) && /[a-f]/i.test(t));
}

export function labelIssues(label: string, noun: string, fileField: string, example: string): string[] {
  const issues: string[] = [];
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

function formatPath(path: PropertyKey[]): string {
  if (path.length === 0) return '$';
  return path.reduce<string>((acc, seg) => {
    if (typeof seg === 'number') return `${acc}[${seg}]`;
    const s = String(seg);
    return acc ? `${acc}.${s}` : s;
  }, '');
}

export const oneLine = (s: string): string =>
  s.split('\n').map((l) => l.trim()).join(' ');

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map(
    (issue) => `${formatPath(issue.path)}: ${oneLine(issue.message)}`,
  );
}
