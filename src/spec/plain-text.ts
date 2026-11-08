import { hasHiddenChars } from '../render/strip.js';
import { CODE_PATTERNS, hashToken } from './shared.js';

const CAMEL_OK = new Set([
  'iPhone', 'iPad', 'iPod', 'iOS', 'iCloud', 'iTunes', 'iMessage', 'iMac', 'eBay', 'macOS', 'tvOS', 'watchOS', 'PayPal', 'GitHub', 'GitLab', 'YouTube', 'LinkedIn', 'WhatsApp', 'WordPress', 'JavaScript', 'TypeScript', 'OpenAI',
]);

const SECRETS = [
  /\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|AKIA[A-Z0-9]{12,}|xox[bpas]-[A-Za-z0-9-]{8,})/,
  /(?:password|passwd|secret|token|api[_-]?key)\s*=\s*\S+/i,
  /(?:password|passwd|secret|token|api[_-]?key)\s*:\s*(?=\S*\d)[^\s-]{8,}(?![^\s.,;!?])/i,
  /-----BEGIN [A-Z ]*-----/,
  /[A-Za-z0-9+/_=-]{32,}/,
];

// `and/or`, `yes/no` and `24/7` read fine in prose: only a leading slash, two slashes or `folder/name.ext` is a path.
const PATH = /(?:^|[\s(])(?:\.{0,2}\/|~\/)[\w.-]+|[\w.-]+\/[\w.-]+\/[\w./-]+|[\w-]+\/[\w-]*\.[A-Za-z0-9]{1,5}\b/;
const FILE = /\b[\w-]+\.(?:ts|tsx|js|mjs|cjs|jsx|py|rb|go|java|json|ya?ml|sql|md|css|html|toml|sh)\b/;
const URL = /https?:\/\/|\bwww\.|\b[\w-]+\.(?:com|io|dev|net|org)\b/i;
const LOWER_CAMEL = /\b[a-z]+[A-Z][A-Za-z0-9]*\b/g;
const UPPER_CAMEL = /\b[A-Z][A-Za-z0-9]*[a-z0-9][A-Z][A-Za-z0-9]*\b/g;
const ENV_VAR = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;
const SNAKE = /\b[A-Za-z0-9]+_[A-Za-z0-9_]+\b/;
const EMPTY_CALL = /\w\(\)/;
const PLURAL_S = /(\w+)\(s\)/g;
const NUMBERS_ONLY = /^[\d/.]+$/;
const TECH_WORDS = new Set([
  'api', 'db', 'svc', 'service', 'handler', 'controller', 'model', 'table', 'config', 'cfg', 'util', 'utils', 'lib', 'repo', 'store', 'cache', 'queue', 'worker', 'cron', 'job', 'hook', 'schema', 'migration', 'endpoint', 'route', 'router', 'client', 'server', 'dto', 'impl',
]);
// Two letters either side keep "e.g." and "i.e." out; digits keep "2.5" out.
const DOTTED = /\b[a-z_]{2,}\.[a-z_]{2,}\b/;

const redact = (token: string): string => `${token.slice(0, 4)}…`;

/** The word around `index`, without the punctuation that ends a sentence. */
function tokenAt(text: string, index: number): string {
  let from = index;
  let to = index;
  while (from > 0 && !/\s/.test(text[from - 1]!)) from--;
  while (to < text.length && !/\s/.test(text[to]!)) to++;
  const word = text.slice(from, to).replace(/^[("]+|[.,;:!?"]+$/g, '');
  return word.includes('(') ? word : word.replace(/\)+$/, '');
}

function matchToken(text: string, re: RegExp): string | undefined {
  const m = re.exec(text);
  return m ? tokenAt(text, m.index + (m[0].length - m[0].trimStart().length)) : undefined;
}

function pathToken(text: string): string | undefined {
  const token = matchToken(text, PATH);
  return token && !NUMBERS_ONLY.test(token) ? token : undefined;
}

const isBrand = (w: string): boolean => CAMEL_OK.has(w) || CAMEL_OK.has(w.replace(/s$/, ''));

/** lowerCamel always reads as code; UpperCamel only with three humps or a digit, so brands like HubSpot pass. */
function camelToken(text: string): string | undefined {
  const lower = (text.match(LOWER_CAMEL) ?? []).find((w) => !isBrand(w));
  return lower ?? (text.match(UPPER_CAMEL) ?? []).find((w) => !isBrand(w) && ((w.match(/[A-Z]/g) ?? []).length >= 3 || /\d/.test(w)));
}

type Check = [what: string, token: (text: string) => string | undefined];

const CHECKS: Check[] = [
  ['looks like a web address', (t) => matchToken(t, URL)],
  ['looks like a file name or path', (t) => pathToken(t) ?? matchToken(t, FILE)],
  ['looks like code', (t) => (t.includes('`') ? '`' : undefined)],
  ...CODE_PATTERNS.filter((p) => p.name !== 'quote').map((p): Check => ['looks like code', (t) => matchToken(t, p.re)]),
  ['looks like code', (t) => matchToken(t, EMPTY_CALL)],
  ['looks like a hash', hashToken],
  ['looks like a setting name', (t) => matchToken(t, ENV_VAR)],
  ['looks like code', camelToken],
  ['looks like code', (t) => matchToken(t, SNAKE)],
  ['looks like code', (t) => matchToken(t, DOTTED)],
];

/** What reads as code, a path, a secret or an id in `text`, as messages for a writer who must use plain words. Quoted phrases stay allowed. */
export function plainTextIssues(text: string): string[] {
  if (hasHiddenChars(text)) return ['must not contain control or invisible characters'];
  for (const re of SECRETS) {
    const token = matchToken(text, re);
    if (token) return [`looks like a secret ("${redact(token)}"); remove it`];
  }
  const words = text.replace(PLURAL_S, '$1');
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const [what, find] of CHECKS) {
    const token = find(words);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    issues.push(`${what} ("${token}"); write it in plain words`);
  }
  return issues;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isTechnicalId = (id: string): boolean => /[_.\d]/.test(id) || id.split('-').length > 2 || id.split('-').some((p) => TECH_WORDS.has(p.toLowerCase()));

/** A technical tech map id copied into prose, such as "refund-api". Ids that read as plain words ("sign-in", "refunds") are just words. */
export function techIdIssue(text: string, techIds: readonly string[]): string | undefined {
  return techIds.find((id) => /[-_]/.test(id) && isTechnicalId(id) && new RegExp(`(?<![\\w-])${id.split(/[-_]/).map(escape).join('[-_]')}(?![\\w-])`, 'i').test(text));
}
