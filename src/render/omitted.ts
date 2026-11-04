import picomatch from 'picomatch';

const GLOB = { dot: true, nobrace: true, noextglob: true };

/**
 * Whether an `omitted` entry (free text, like "tests: test_teams.py" or "docs: CHANGELOG.md, docs/")
 * names `file`, a repo-relative changed path with `/`: by path, file name, `folder/` or glob.
 */
export function explains(entry: string, file: string): boolean {
  const name = file.slice(file.lastIndexOf('/') + 1);
  return entry
    .split(/[\s,:;()]+/)
    .map((t) => t.replace(/^\.\//, ''))
    .some((t) => {
      if (t === '') return false;
      if (t.includes('*')) return picomatch.isMatch(file, t, { ...GLOB, basename: !t.includes('/') });
      if (t.endsWith('/')) return file.startsWith(t);
      return t === file || t === name;
    });
}
