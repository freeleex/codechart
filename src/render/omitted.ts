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
