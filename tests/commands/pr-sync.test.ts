import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncReview } from '../../src/commands/pr-sync.js';
import { replaceSection, specInDescription } from '../../src/pr/description.js';
import { githubReview, gitlabReview, type Review } from '../../src/pr/platforms.js';
import { prBlock } from '../../src/render/pr.js';
import type { Spec } from '../../src/spec/schema.js';
import { git, makeSandbox, removeSandbox, type Sandbox } from '../helpers/sandbox.js';

const spec = (path: string): Spec => ({
  title: 'Invoices',
  kind: 'summary',
  nodes: [{ id: 'inv', label: 'invoice service', kind: 'service', status: 'new', layer: 'backend', path }],
  edges: [],
});

describe('specInDescription / replaceSection', () => {
  const body = `Intro text.\n\n${prBlock(spec('src/inv.ts'), undefined, 'old.svg')}\nOutro.`;

  it('reads the hidden spec back', () => {
    expect(specInDescription(body)).toEqual(spec('src/inv.ts'));
    expect(specInDescription('no map here')).toBeUndefined();
  });

  it('replaces only the codechart section', () => {
    const out = replaceSection(body, '<!-- codechart:start -->\nNEW\n<!-- codechart:end -->\n');
    expect(out).toBe('Intro text.\n\n<!-- codechart:start -->\nNEW\n<!-- codechart:end -->\n\nOutro.');
  });
});

describe('syncReview', () => {
  let sb: Sandbox;
  let base: string;
  beforeEach(() => {
    sb = makeSandbox('pr-sync', { git: 'init' });
    git(sb.repo, 'commit', '-q', '--allow-empty', '-m', 'base');
    base = git(sb.repo, 'rev-parse', 'HEAD').trim();
    mkdirSync(join(sb.repo, 'src'));
    writeFileSync(join(sb.repo, 'src', 'inv.ts'), 'export {};\n');
    writeFileSync(join(sb.repo, 'src', 'later.ts'), 'export {};\n');
    git(sb.repo, 'add', '.');
    git(sb.repo, 'commit', '-q', '-m', 'work');
  });
  afterEach(() => removeSandbox(sb.tmp));

  function fakeReview(body: string): Review & { saved?: string; svg?: string } {
    const r: Review & { saved?: string; svg?: string } = {
      name: 'PR #1',
      base,
      head: 'HEAD',
      body: async () => body,
      setBody: async (b) => void (r.saved = b),
      publish: async (svg) => ((r.svg = svg), 'https://example.com/raw/abc/map.svg'),
    };
    return r;
  }

  it('re-renders against the latest commits, publishes the SVG and swaps the section', async () => {
    const review = fakeReview(`Text.\n\n${prBlock(spec('src/inv.ts'), undefined, 'old.svg')}`);
    let out = '';
    await syncReview({ stdout: (s) => (out += s), stderr: () => {}, home: sb.home, env: {} }, sb.repo, { review });
    expect(out).toBe('codechart: updated the map in PR #1\n');
    expect(review.svg).toMatch(/^<svg /);
    expect(review.saved).toMatch(/^Text\.\n\n<!-- codechart:start -->/);
    expect(review.saved).toContain('(https://example.com/raw/abc/map.svg)');
    expect(review.saved).not.toContain('old.svg');
    expect(review.saved).toContain('✓ 1 node checked against the code');
    expect(review.saved).toContain('Changed, not on map** (1): `src/later.ts`');
  });

  it('leaves a description without a map alone', async () => {
    const review = fakeReview('Just text.');
    let out = '';
    await syncReview({ stdout: (s) => (out += s), stderr: () => {}, env: {} }, sb.repo, { review });
    expect(out).toContain('has no codechart map in its description');
    expect(review.saved).toBeUndefined();
  });
});

describe('githubReview', () => {
  let sb: Sandbox;
  afterEach(() => removeSandbox(sb.tmp));

  it('reads the PR from the event, edits its body, and pushes the image to refs/codechart/pr-<n>, not a branch', async () => {
    sb = makeSandbox('gh-review', { git: 'init' });
    git(sb.repo, 'commit', '-q', '--allow-empty', '-m', 'base');
    const remote = join(sb.tmp, 'remote.git');
    git(sb.tmp, 'init', '-q', '--bare', remote);
    git(sb.repo, 'remote', 'add', 'origin', remote);
    const event = join(sb.tmp, 'event.json');
    writeFileSync(event, JSON.stringify({ pull_request: { number: 5, base: { sha: 'b1' }, head: { sha: 'h1' } } }));
    const calls: string[] = [];
    const fake = (async (url: string, init: RequestInit = {}) => {
      calls.push(`${init.method ?? 'GET'} ${url} ${new Headers(init.headers).get('authorization')}`);
      return new Response(JSON.stringify({ body: 'old' }), { status: 200 });
    }) as typeof fetch;
    const review = githubReview({ GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' }, sb.repo, fake);
    expect([review.name, review.base, review.head]).toEqual(['PR #5', 'b1', 'h1']);
    expect(await review.body()).toBe('old');
    await review.setBody('new');
    const url = await review.publish('<svg/>');
    const sha = git(remote, 'rev-parse', 'refs/codechart/pr-5').trim();
    expect(url).toBe(`https://github.com/o/r/raw/${sha}/map.svg`);
    expect(git(remote, 'show', `${sha}:map.svg`)).toBe('<svg/>');
    expect(git(remote, 'branch', '--list')).toBe('');
    expect(calls).toEqual(['GET https://api.github.com/repos/o/r/pulls/5 Bearer t', 'PATCH https://api.github.com/repos/o/r/pulls/5 Bearer t']);
  });
});

describe('gitlabReview', () => {
  const env = {
    CI_MERGE_REQUEST_IID: '7',
    CI_API_V4_URL: 'https://gl.example/api/v4',
    CI_PROJECT_ID: '42',
    CODECHART_GITLAB_TOKEN: 'tok',
    CI_MERGE_REQUEST_DIFF_BASE_SHA: 'b1',
    CI_COMMIT_SHA: 'h1',
  };

  it('reads and writes the MR description and uploads the image with the token', async () => {
    const calls: { url: string; method: string; token: string | null }[] = [];
    const fake = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET', token: new Headers(init.headers).get('private-token') });
      const json = url.endsWith('/uploads') ? { url: '/uploads/x/map.svg' } : { description: 'body' };
      return new Response(JSON.stringify(json), { status: 200 });
    }) as typeof fetch;
    const review = gitlabReview(env, fake);
    expect([review.base, review.head, review.name]).toEqual(['b1', 'h1', 'MR !7']);
    expect(await review.body()).toBe('body');
    expect(await review.publish('<svg/>')).toBe('/uploads/x/map.svg');
    await review.setBody('new');
    expect(calls.map((c) => `${c.method} ${c.url} ${c.token}`)).toEqual([
      'GET https://gl.example/api/v4/projects/42/merge_requests/7 tok',
      'POST https://gl.example/api/v4/projects/42/uploads tok',
      'PUT https://gl.example/api/v4/projects/42/merge_requests/7 tok',
    ]);
  });

  it('says which variable is missing', () => {
    expect(() => gitlabReview({ ...env, CODECHART_GITLAB_TOKEN: '' })).toThrow('CODECHART_GITLAB_TOKEN is not set');
  });
});
