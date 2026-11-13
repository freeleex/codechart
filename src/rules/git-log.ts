import { git } from './git-run.js';

/** The newest tag matching `pattern` reachable from commit `sha`; undefined when there is none. */
export function gitLatestTag(cwd: string, sha: string, pattern: string): string | undefined {
  try {
    return git(cwd, ['describe', '--tags', '--abbrev=0', '--match', pattern, sha]).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Up to `max` tag names whose ref matches `pattern` (`refs/tags` for all) on commits before `head`: reachable from it, not on it. */
export function gitTagNames(cwd: string, pattern: string, max: number, head: string): string[] {
  return git(cwd, ['for-each-ref', `--merged=${head}`, '--format=%(refname:short)%09%(objectname)%09%(*objectname)', pattern])
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'))
    .filter(([, sha, peeled]) => (peeled || sha) !== head)
    .slice(0, max)
    .map(([name]) => name!);
}

export const gitIsShallow = (cwd: string): boolean => git(cwd, ['rev-parse', '--is-shallow-repository']).trim() === 'true';

/** One commit of `gitFirstParentLog`. */
export interface LogEntry {
  sha: string;
  short: string;
  date: string;
  subject: string;
  body: string;
}

/** The first-parent commits in `since..head`, or all of `head`'s without `since` (full shas), oldest first. */
export function gitFirstParentLog(cwd: string, since: string | undefined, head: string): LogEntry[] {
  const out = git(cwd, ['log', '--first-parent', '--reverse', '--no-color', '--no-show-signature', '--format=%H%x1f%h%x1f%cI%x1f%s%x1f%b%x1e', since ? `${since}..${head}` : head, '--']);
  return out
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [sha = '', short = '', date = '', subject = '', body = ''] = r.split('\x1f');
      return { sha, short, date, subject, body: body.trim() };
    });
}
