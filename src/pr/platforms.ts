import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gitBinary } from '../rules/git-files.js';

/** One PR or MR, as CI sees it: its diff range, its description, and where the map image goes. */
export interface Review {
  name: string;
  base: string;
  head: string;
  body(): Promise<string>;
  setBody(body: string): Promise<void>;
  /** Stores the SVG where the description can load it, for readers with access to the repo; returns its URL. */
  publish(svg: string): Promise<string>;
}

type Env = NodeJS.ProcessEnv;
type Fetch = typeof fetch;

function need(env: Env, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function call(fetchFn: Fetch, url: string, init: RequestInit, what: string): Promise<Response> {
  const res = await fetchFn(url, init);
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

function run(cwd: string, args: string[], input?: string): string {
  return execFileSync(gitBinary(), args, { cwd, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 }).trim();
}

/** GitHub Actions on a pull_request event. The image is a commit on refs/codechart/pr-<n>, not a branch. */
export function githubReview(env: Env, cwd: string, fetchFn: Fetch = fetch): Review {
  const event = JSON.parse(readFileSync(need(env, 'GITHUB_EVENT_PATH'), 'utf8')) as { pull_request?: { number: number; base: { sha: string }; head: { sha: string } } };
  const pr = event.pull_request;
  if (!pr) throw new Error('not a pull_request event');
  const repo = need(env, 'GITHUB_REPOSITORY');
  const api = `${env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${repo}/pulls/${pr.number}`;
  const headers = { authorization: `Bearer ${need(env, 'GITHUB_TOKEN')}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' };
  return {
    name: `PR #${pr.number}`,
    base: pr.base.sha,
    head: pr.head.sha,
    body: async () => ((await (await call(fetchFn, api, { headers }, 'reading the PR')).json()) as { body: string | null }).body ?? '',
    setBody: async (body) => {
      await call(fetchFn, api, { method: 'PATCH', headers, body: JSON.stringify({ body }) }, 'updating the PR');
    },
    publish: async (svg) => {
      const blob = run(cwd, ['hash-object', '-w', '--stdin'], svg);
      const tree = run(cwd, ['mktree'], `100644 blob ${blob}\tmap.svg\n`);
      const commit = run(cwd, ['-c', 'user.name=codechart', '-c', 'user.email=codechart@users.noreply.github.com', 'commit-tree', tree, '-m', `codechart map for PR #${pr.number}`]);
      run(cwd, ['push', '--force', 'origin', `${commit}:refs/codechart/pr-${pr.number}`]);
      return `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repo}/raw/${commit}/map.svg`;
    },
  };
}

/** GitLab CI in a merge request pipeline. CI_JOB_TOKEN can't edit an MR, so it needs CODECHART_GITLAB_TOKEN (api scope). */
export function gitlabReview(env: Env, fetchFn: Fetch = fetch): Review {
  const iid = need(env, 'CI_MERGE_REQUEST_IID');
  const project = `${need(env, 'CI_API_V4_URL')}/projects/${need(env, 'CI_PROJECT_ID')}`;
  const headers = { 'private-token': need(env, 'CODECHART_GITLAB_TOKEN') };
  const mr = `${project}/merge_requests/${iid}`;
  return {
    name: `MR !${iid}`,
    base: need(env, 'CI_MERGE_REQUEST_DIFF_BASE_SHA'),
    head: need(env, 'CI_COMMIT_SHA'),
    body: async () => ((await (await call(fetchFn, mr, { headers }, 'reading the MR')).json()) as { description: string | null }).description ?? '',
    setBody: async (description) => {
      await call(fetchFn, mr, { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ description }) }, 'updating the MR');
    },
    publish: async (svg) => {
      const form = new FormData();
      form.append('file', new Blob([svg], { type: 'image/svg+xml' }), 'map.svg');
      const res = await call(fetchFn, `${project}/uploads`, { method: 'POST', headers, body: form }, 'uploading the map');
      // A project-relative /uploads/... path: GitLab serves it to readers with access to the project.
      return ((await res.json()) as { url: string }).url;
    },
  };
}

export function reviewFromEnv(env: Env, cwd: string, fetchFn: Fetch = fetch): Review {
  if (env.GITHUB_ACTIONS === 'true') return githubReview(env, cwd, fetchFn);
  if (env.GITLAB_CI === 'true') return gitlabReview(env, fetchFn);
  throw new Error('run this in GitHub Actions (pull_request event) or a GitLab merge request pipeline');
}
