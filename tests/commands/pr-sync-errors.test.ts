import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncReview } from '../../src/commands/pr-sync.js';
import { replaceSection, specInDescription } from '../../src/pr/description.js';
import { githubReview, gitlabReview, reviewFromEnv, type Review } from '../../src/pr/platforms.js';
import { BLOCK_END, BLOCK_START, SPEC_OPEN } from '../../src/render/pr.js';
import { makeTempDir, removeTempDir, runCli } from '../helpers/sandbox.js';

// A render that prints nothing at all, which a real one never does.
vi.mock('../../src/commands/render.js', () => ({
  renderCommand: () => new Command('render').argument('[spec]').allowUnknownOption().allowExcessArguments().action(() => {}),
}));

let tmp: string;
beforeEach(() => {
  tmp = makeTempDir('pr-sync-errors');
});
afterEach(() => removeTempDir(tmp));

const event = (content: unknown): string => {
  const file = join(tmp, 'event.json');
  writeFileSync(file, JSON.stringify(content));
  return file;
};
const pullRequest = { pull_request: { number: 5, base: { sha: 'b1' }, head: { sha: 'h1' } } };
const ghEnv = (file: string) => ({ GITHUB_EVENT_PATH: file, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' });
const glEnv = {
  CI_MERGE_REQUEST_IID: '7',
  CI_API_V4_URL: 'https://gl.example/api/v4',
  CI_PROJECT_ID: '42',
  CODECHART_GITLAB_TOKEN: 'tok',
  CI_MERGE_REQUEST_DIFF_BASE_SHA: 'b1',
  CI_COMMIT_SHA: 'h1',
};
const answering = (status: number, body: string) => (async () => new Response(body, { status })) as typeof fetch;

describe('pr-sync outside CI', () => {
  it('says where to run it and exits 1', async () => {
    const r = await runCli({ cwd: tmp, home: tmp, env: {} }, ['pr-sync']);
    expect(r.err).toBe('codechart: run this in GitHub Actions (pull_request event) or a GitLab merge request pipeline\n');
    expect(r.code).toBe(1);
    process.exitCode = undefined;
  });
});

describe('syncReview when render prints nothing', () => {
  it('fails with render printed nothing', async () => {
    const review: Review = {
      name: 'PR #1',
      base: 'b',
      head: 'h',
      current: async () => ({ body: `${BLOCK_START}\n${SPEC_OPEN}\n{"title":"t","kind":"summary","nodes":[],"edges":[]}\n-->\n${BLOCK_END}`, head: 'h' }),
      setBody: async () => {},
      publish: async () => 'u',
    };
    await expect(syncReview({ stdout: () => {}, stderr: () => {}, home: tmp, env: {} }, tmp, { review })).rejects.toThrow('render printed nothing');
  });
});

describe('reviews from the platform APIs', () => {
  it('an HTTP 403 fails with the status and the start of the body', async () => {
    const gh = githubReview(ghEnv(event(pullRequest)), tmp, answering(403, 'Resource not accessible by integration'));
    await expect(gh.current()).rejects.toThrow('reading the PR failed: HTTP 403 Resource not accessible by integration');
    await expect(gh.setBody('x')).rejects.toThrow('updating the PR failed: HTTP 403');
    const gl = gitlabReview(glEnv, answering(403, '{"message":"403 Forbidden"}'));
    await expect(gl.current()).rejects.toThrow('reading the MR failed: HTTP 403 {"message":"403 Forbidden"}');
  });

  it('a push event is refused', () => {
    expect(() => githubReview(ghEnv(event({ ref: 'refs/heads/main' })), tmp)).toThrow('not a pull_request event');
  });
});

describe('reviewFromEnv', () => {
  it('picks GitHub or GitLab from the environment and refuses to run outside both', () => {
    expect(reviewFromEnv({ ...ghEnv(event(pullRequest)), GITHUB_ACTIONS: 'true' }, tmp).name).toBe('PR #5');
    expect(reviewFromEnv({ ...glEnv, GITLAB_CI: 'true' }, tmp).name).toBe('MR !7');
    expect(() => reviewFromEnv({}, tmp)).toThrow('run this in GitHub Actions (pull_request event) or a GitLab merge request pipeline');
    expect(() => reviewFromEnv({ GITHUB_ACTIONS: 'false', GITLAB_CI: 'false' }, tmp)).toThrow('run this in GitHub Actions');
  });
});

describe('the description', () => {
  it('a spec that is not JSON fails', () => {
    expect(() => specInDescription(`${BLOCK_START}\n${SPEC_OPEN}\n{ nope\n-->\n${BLOCK_END}`)).toThrow('the codechart spec in the description is not valid JSON');
  });

  it('replacing a section that is not there fails', () => {
    expect(() => replaceSection('just text', 'new')).toThrow('no codechart section in the description');
    expect(() => replaceSection(`${BLOCK_START} but no end`, 'new')).toThrow('no codechart section in the description');
  });
});
