import {
  gitChangedFiles,
  gitCommitFiles,
  gitEmptyTree,
  gitHead,
  gitMergeBase,
  gitParent,
  gitSinceFiles,
  repoDiffOverrides,
  repoFilterOverrides,
  resolveCommit,
  type DiffRange,
} from './git-files.js';

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
  let files: string[] = [];
  if (o.since !== undefined) files = files.concat(gitSinceFiles(root, o.since, o.head));
  if (o.commit !== undefined) files = files.concat(gitCommitFiles(root, o.commit));
  if (o.git) files = files.concat(gitChangedFiles(root, renameSources));
  return files;
}

/** The revisions `gitFiles` compares, for reading a file's diff over the same change. */
export function diffRange(root: string, o: GitSelection): DiffRange {
  const config = repoDiffOverrides(root);
  if (o.commit !== undefined) {
    const sha = resolveCommit(root, '--commit', o.commit);
    return { args: [gitParent(root, sha) ?? gitEmptyTree(root), sha], worktree: false, config };
  }
  if (o.since !== undefined && !o.git) {
    return { args: [`${o.since}...${o.head ?? 'HEAD'}`], worktree: false, config };
  }
  const from = o.since !== undefined ? gitMergeBase(root, o.since) : (gitHead(root) ?? gitEmptyTree(root));
  // Diffing working-tree files runs the repo's clean filters, as status would.
  return { args: [from], worktree: true, config: [...config, ...repoFilterOverrides(root)] };
}
