import { gitChangedFiles, gitCommitFiles, gitSinceFiles } from './git-files.js';

export interface GitSelection {
  git?: boolean;
  commit?: string;
  since?: string;
  head?: string;
}

export const csv = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

export function selectionError(o: GitSelection & { files?: string }): string | undefined {
  if (o.files !== undefined && csv(o.files).length === 0) return '--files is empty';
  const sources = [o.files !== undefined, o.git, o.commit !== undefined, o.since !== undefined].filter(Boolean).length;
  const gitPlusSince = sources === 2 && o.git && o.since !== undefined;
  if (sources === 0 || (sources > 1 && !gitPlusSince)) {
    return 'specify one of --files, --git, --commit or --since (only --git and --since combine)';
  }
  if (o.head !== undefined && o.since === undefined) return '--head needs --since';
  if (o.head !== undefined && o.git) return '--head compares another branch, so it does not combine with --git';
  return undefined;
}

export const hasGitSelection = (o: GitSelection): boolean =>
  Boolean(o.git) || o.commit !== undefined || o.since !== undefined || o.head !== undefined;

/** `renameSources`: with --git, also list the paths renames moved from. */
export function gitFiles(root: string | undefined, o: GitSelection, renameSources = false): string[] {
  if (!root) throw new Error('not a git repository (use --files)');
  const files: string[] = [];
  if (o.since !== undefined) files.push(...gitSinceFiles(root, o.since, o.head));
  if (o.commit !== undefined) files.push(...gitCommitFiles(root, o.commit));
  if (o.git) files.push(...gitChangedFiles(root, renameSources));
  return files;
}
