import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import picomatch from 'picomatch';
import type { Config } from '../config/schema.js';
import { repoFolder } from '../render/output-path.js';
import { versionSlug } from '../render/release/slug.js';
import { gitBranch } from '../rules/git-files.js';

export interface ReleaseHint {
  action: 'suggest' | 'draw' | 'done';
  branch: string;
  /** What `check` made out of the branch name; absent when there is none. */
  version?: string;
  /** With `done`: the PDF, or the page when only that is left. */
  path?: string;
}

const VERSION = /(?:^|[^0-9A-Za-z])v?(\d+\.\d+(?:\.\d+)?)(?![0-9A-Za-z])/;

/** The first x.y.z or x.y in a branch name, after an optional `v`: "release-0.8.0" gives "0.8.0". */
export const branchVersion = (branch: string): string | undefined => VERSION.exec(branch)?.[1];

/** "2-1-0" and "2-1" both give "2-1": trailing zero groups go, but x.y stays. */
function normalised(slug: string): string {
  const groups = slug.split('-');
  while (groups.length > 2 && groups.at(-1) === '0') groups.pop();
  return groups.join('-');
}

/** The version a saved page's name leads with: all groups before `--`, or up to three number groups in older names without it. */
const normalisedSaved = (name: string): string | undefined => {
  const rest = name.slice(16);
  const slug = /^v(\d+(?:-\d+)*)--/.exec(rest)?.[1] ?? /^v(\d+(?:-\d+){0,2})-/.exec(rest)?.[1];
  return slug && normalised(slug);
};

/** The newest saved release page or PDF for `version`: the PDF when there is one. */
function existing(config: Config, root: string, version: string): string | undefined {
  const dir = join(config.web.outDir, repoFolder(root));
  const wanted = normalised(versionSlug(version));
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return undefined;
  }
  const found = (ext: string) => names.filter((n) => /^\d{8}-\d{6}-/.test(n) && normalisedSaved(n) === wanted && n.endsWith(`.release.${ext}`)).sort().at(-1);
  const name = found('pdf') ?? found('html');
  return name && join(dir, name);
}

/** Whether `branch` is a release branch and what the agent should do about it; undefined when it is not or `release.auto` is off. */
export function releaseHint(config: Config, root: string, head?: string): ReleaseHint | undefined {
  const { branches, auto } = config.release;
  const branch = head === undefined ? gitBranch(root) : head.replace(/^(?:refs\/heads\/|refs\/remotes\/[^/]+\/|origin\/)/, '');
  if (auto === 'off' || !branch || branch === '(detached)' || !picomatch.isMatch(branch, branches, { dot: true })) return undefined;
  const version = branchVersion(branch);
  const base = { branch, ...(version && { version }) };
  // Without a version a saved PDF can't be matched, so drawing would repeat on every check.
  if (auto === 'suggest' || version === undefined) return { action: 'suggest', ...base };
  const path = version === undefined ? undefined : existing(config, root, version);
  return path === undefined ? { action: 'draw', ...base } : { action: 'done', ...base, path };
}
