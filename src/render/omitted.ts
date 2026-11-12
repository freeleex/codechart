import picomatch from 'picomatch';

const GLOB = { dot: true, nobrace: true, noextglob: true };
const SEP = /[\s,:;()]/;

/** `s` appears in `text` with a separator or an end on each side, so names with spaces count whole. */
function mentions(text: string, s: string): boolean {
  for (let i = text.indexOf(s); i >= 0; i = text.indexOf(s, i + 1)) {
    const before = i === 0 || SEP.test(text[i - 1]!) || text.slice(i - 2, i) === './';
    const after = i + s.length === text.length || SEP.test(text[i + s.length]!);
    if (before && after) return true;
  }
  return false;
}

function tokenNames(t: string, file: string): boolean {
  if (/[*?[]/.test(t)) return picomatch.isMatch(file, t, { ...GLOB, basename: !t.includes('/') });
  return t.endsWith('/') && file.startsWith(t);
}

/**
 * Whether an `omitted` entry (free text, like "tests: test_teams.py" or "docs: CHANGELOG.md, docs/")
 * names `file`, a repo-relative changed path with `/`: by path, file name, `folder/` or glob.
 */
export function explains(entry: string, file: string): boolean {
  if (mentions(entry, file) || mentions(entry, file.slice(file.lastIndexOf('/') + 1))) return true;
  return entry
    .split(/[\s,:;()]+/)
    .map((t) => t.replace(/^\.\//, ''))
    .some((t) => t !== '' && tokenNames(t, file));
}

const PATH_TOKEN = /[*?[]/;
const PLAIN_WORD = /^[A-Za-z][A-Za-z'_-]*$/;
/** "tests and docs" names categories, not a reason: only the words that say what the group is count. */
const STOP = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

/** The entry's tokens with `./` and a trailing comma or semicolon dropped, as `explains` reads them. */
const tokens = (entry: string): string[] =>
  entry
    .split(/[\s,:;()]+/)
    .map((t) => t.replace(/^\.\//, '').replace(/[,;]+$/, ''))
    .filter((t) => t !== '');

/** The path tokens in an entry: a glob, a `folder/`, or a path with a `/` in it (its place on the map). */
export const entryPaths = (entry: string): string[] => tokens(entry).filter((t) => PATH_TOKEN.test(t) || t.includes('/'));

/** The words that say what the omitted group is, no paths, file names or stop words: `tests and docs` has two. */
export const entryWords = (entry: string): string[] => tokens(entry).filter((t) => PLAIN_WORD.test(t) && !STOP.has(t.toLowerCase()));

/** The entry without its path tokens: the reason it gives for leaving those files off the map. */
export function entryProse(entry: string): string {
  return entry
    .split(/\s+/)
    .filter((w) => {
      const t = w.replace(/^\.\//, '').replace(/[,;]+$/, '');
      return t === '' || !(PATH_TOKEN.test(t) || t.includes('/'));
    })
    .join(' ')
    .replace(/[\s,;:]+$/, '')
    .trim();
}
