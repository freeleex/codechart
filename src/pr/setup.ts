import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { packageFile } from '../assets.js';
import { hasHiddenChars } from '../render/strip.js';
import { gitRun } from './git.js';

export type Host = 'github' | 'gitlab';

export interface Remote {
  host: Host;
  /** e.g. github.com or gitlab.example.com */
  server: string;
  /** owner/repo or group/sub/project */
  path: string;
}

const PATTERNS = [/^[\w.-]+@([^:/]+):(.+?)(?:\.git)?\/?$/, /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/];

/** The forge behind a remote URL; undefined when the host name names neither. */
export function parseRemote(url: string, host?: Host): Remote | undefined {
  for (const re of PATTERNS) {
    const m = re.exec(url.trim());
    if (!m) continue;
    const server = m[1]!.toLowerCase();
    if (hasHiddenChars(server + m[2]!)) return undefined;
    const found = host ?? (server.includes('github') ? 'github' : server.includes('gitlab') ? 'gitlab' : undefined);
    return found ? { host: found, server, path: m[2]! } : undefined;
  }
  return undefined;
}

export interface Plan {
  remote: Remote;
  /** Repo-relative. */
  file: string;
  /** The whole file after setup. */
  content: string;
  /** What is added: the whole file, or the job appended to an existing .gitlab-ci.yml. */
  added: string;
  appended: boolean;
  /** Lines for the user: what runs, with which token, and what is left to do. */
  notes: string[];
}

/** The CI file from templates/, running this codechart version, so an upgrade is a change someone reviews. */
function pinnedTemplate(host: Host, version: string): string {
  const file = host === 'github' ? 'templates/github-workflow.yml' : 'templates/gitlab-ci.yml';
  return readFileSync(packageFile(file), 'utf8').replace('codechart@latest', `codechart@${version}`);
}

const GITHUB_NOTES = [
  'Runs on every push to a pull request that has a codechart map section in its description; others are left alone.',
  'Uses the built-in GITHUB_TOKEN with contents: write (to push the map image to refs/codechart/pr-<n>, never a branch) and pull-requests: write (to update the description). No secret to add.',
  'Pull requests from forks are skipped: their token is read-only.',
];

function gitlabNotes(r: Remote): string[] {
  const base = `https://${r.server}`;
  return [
    'Runs in merge request pipelines whose description has a codechart map section; others are left alone.',
    'Needs one masked CI/CD variable, CODECHART_GITLAB_TOKEN (GitLab’s job token can’t edit merge requests or upload files):',
    `  1. Create an access token with api scope, from a user with at least the Developer role: ${base}/-/user_settings/personal_access_tokens?name=codechart&scopes=api`,
    `  2. Add it under Settings > CI/CD > Variables, masked: ${base}/${r.path}/-/settings/ci_cd`,
    'Until the variable exists the job is skipped.',
  ];
}

/**
 * What setting up PR maps adds to the repo, from the files in `read` (the work tree or a commit);
 * undefined when it is already set up.
 */
export function buildPlan(remote: Remote, version: string, read: (file: string) => string | undefined): Plan | undefined {
  const added = pinnedTemplate(remote.host, version);
  if (remote.host === 'github') {
    const file = '.github/workflows/codechart.yml';
    const existing = read(file);
    if (existing !== undefined) return existing.includes('pr-sync') ? undefined : conflict(file);
    return { remote, file, content: added, added, appended: false, notes: GITHUB_NOTES };
  }
  const file = '.gitlab-ci.yml';
  const existing = read(file);
  if (existing?.includes('pr-sync')) return undefined;
  if (existing !== undefined && /^codechart-map:/m.test(existing)) conflict(file);
  const stage = existing === undefined ? undefined : appendedStage(existing);
  const job = stage === undefined ? added : added.replace(/^codechart-map:\n/m, `codechart-map:\n  stage: ${JSON.stringify(stage)}\n`);
  const content = existing === undefined ? job : `${existing.replace(/\n*$/, '\n')}\n${job}`;
  return { remote, file, content, added: job, appended: existing !== undefined, notes: gitlabNotes(remote) };
}

/** A stage from the file's own `stages:` when it lists no `test`, the stage a job without one runs in. */
function appendedStage(existing: string): string | undefined {
  let stages: unknown;
  try {
    stages = (parse(existing, { logLevel: 'error' }) as { stages?: unknown } | null)?.stages;
  } catch {
    return undefined;
  }
  if (!Array.isArray(stages) || stages.includes('test')) return undefined;
  // .pre and .post jobs alone make no pipeline
  const stage = stages.find((s): s is string => typeof s === 'string' && s !== '.pre' && s !== '.post');
  if (stage === undefined) throw new Error(`.gitlab-ci.yml lists no stage codechart's job can run in; set PR maps up by hand: ${BY_HAND}`);
  return stage;
}

const BY_HAND = 'https://github.com/freeleex/codechart/blob/main/docs/pr-maps.md#by-hand';

function conflict(file: string): never {
  throw new Error(`${file} already exists and is not codechart's; move it or set PR maps up by hand: ${BY_HAND}`);
}

export const SETUP_BRANCH = 'codechart/pr-maps';

const PR_TITLE = 'Set up codechart PR maps';

const prBody = (plan: Plan): string =>
  [
    `Adds \`${plan.file}\`${plan.appended ? ' (one job appended)' : ''} so codechart keeps the map in pull request descriptions current. Opened by \`codechart setup-pr-maps --pr\`.`,
    '',
    '**Merge to turn PR maps on; close to say no.** Nothing runs until this is merged.',
    '',
    ...plan.notes.map((n) => (n.startsWith('  ') ? n : `- ${n}`)),
  ].join('\n');

/** `server` is the remote's host: gh and glab run without token variables for any host but github.com and gitlab.com. */
export type Tool = (command: string, args: string[], server?: string) => string;

export interface Prepared {
  defaultBranch: string;
  base: string;
  /** Undefined when the default branch already has PR maps. */
  plan?: Plan;
}

/** Fetches the remote's default branch and plans the change against it, not against the work tree. */
export function prepareSetupReview(root: string, version: string, remote: Remote): Prepared {
  const defaultBranch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(gitRun(root, ['ls-remote', '--symref', 'origin', 'HEAD']))?.[1];
  if (!defaultBranch) throw new Error("couldn't find origin's default branch");
  gitRun(root, ['fetch', '--quiet', 'origin', `refs/heads/${defaultBranch}`]);
  const base = gitRun(root, ['rev-parse', 'FETCH_HEAD']);
  const plan = buildPlan(remote, version, (file) => {
    try {
      return gitRun(root, ['show', `${base}:${file}`]) + '\n';
    } catch {
      return undefined;
    }
  });
  return { defaultBranch, base, plan };
}

/** Undefined when origin has no setup branch yet; else the URL of the request opened from it, '' when gh/glab can't find one. */
export function existingSetupReview(root: string, { host, server }: Remote, tool: Tool): string | undefined {
  if (!gitRun(root, ['ls-remote', 'origin', `refs/heads/${SETUP_BRANCH}`])) return undefined;
  try {
    const out =
      host === 'github'
        ? tool('gh', ['pr', 'list', '--head', SETUP_BRANCH, '--state', 'all', '--limit', '1', '--json', 'url'], server)
        : tool('glab', ['mr', 'list', '--source-branch', SETUP_BRANCH, '--all', '--output', 'json'], server);
    const [first] = JSON.parse(out) as { url?: unknown; web_url?: unknown }[];
    const url = first?.url ?? first?.web_url;
    return typeof url === 'string' ? url : '';
  } catch {
    return '';
  }
}

/**
 * Commits the plan on top of the default branch in a scratch index, pushes it as a new branch and opens a pull or
 * merge request with `tool` (gh or glab); returns its URL. The work tree, index and current branch are not touched.
 */
export function openSetupReview(root: string, { defaultBranch, base, plan }: Prepared & { plan: Plan }, tool: Tool): string {
  const dir = mkdtempSync(join(tmpdir(), 'codechart-setup-'));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') };
    gitRun(root, ['read-tree', base], undefined, env);
    const blob = gitRun(root, ['hash-object', '-w', '--stdin'], plan.content);
    gitRun(root, ['update-index', '--add', '--cacheinfo', `100644,${blob},${plan.file}`], undefined, env);
    const tree = gitRun(root, ['write-tree'], undefined, env);
    const commit = gitRun(root, ['commit-tree', tree, '-p', base, '-m', PR_TITLE]);
    gitRun(root, ['push', 'origin', `${commit}:refs/heads/${SETUP_BRANCH}`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const out =
    plan.remote.host === 'github'
      ? tool('gh', ['pr', 'create', '--base', defaultBranch, '--head', SETUP_BRANCH, '--title', PR_TITLE, '--body', prBody(plan)], plan.remote.server)
      : tool('glab', ['mr', 'create', '--source-branch', SETUP_BRANCH, '--target-branch', defaultBranch, '--title', PR_TITLE, '--description', prBody(plan), '--yes'], plan.remote.server);
  return out.trim().split('\n').pop() ?? '';
}
