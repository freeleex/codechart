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

  type Fake = Review & { saved?: string; svg?: string; reads: number };

  /** `states`: what each read of the PR returns, in turn; the last one repeats. */
  function fakeReview(...states: (string | { body: string; head: string })[]): Fake {
    const r: Fake = {
      name: 'PR #1',
      base,
      head: 'HEAD',
      reads: 0,
      current: async () => {
        const st = states[Math.min(r.reads++, states.length - 1)]!;
        return typeof st === 'string' ? { body: st, head: 'HEAD' } : st;
      },
      setBody: async (b) => void (r.saved = b),
      publish: async (svg) => ((r.svg = svg), 'https://example.com/raw/abc/map.svg'),
    };
    return r;
  }

  async function sync(review: Review): Promise<string> {
    let out = '';
    await syncReview({ stdout: (s) => (out += s), stderr: () => {}, home: sb.home, env: {} }, sb.repo, { review });
    return out;
  }

  const section = (path = 'src/inv.ts', extra: Partial<Spec> = {}) => prBlock({ ...spec(path), ...extra }, undefined, 'old.svg');

  it('re-renders against the latest commits, publishes the SVG and swaps the section', async () => {
    const review = fakeReview(`Text.\n\n${section()}`);
    expect(await sync(review)).toBe('codechart: updated the map in PR #1\n');
    expect(review.svg).toMatch(/^<svg /);
    expect(review.saved).toMatch(/^Text\.\n\n<!-- codechart:start -->/);
    expect(review.saved).toContain('(https://example.com/raw/abc/map.svg)');
    expect(review.saved).not.toContain('old.svg');
    expect(review.saved).toContain('✓ 1 node checked against the code');
    expect(review.saved).toContain('Changed, not on map** (1): `src/later.ts`');
  });

  it('keeps description edits made while it was drawing', async () => {
    const review = fakeReview(`Text.\n\n${section()}`, `Text.\n\n${section()}`, `Text.\n\n${section()}`, `Edited text.\n\n${section()}\nAdded later.`);
    await sync(review);
    expect(review.saved).toMatch(/^Edited text\.\n\n<!-- codechart:start -->/);
    expect(review.saved).toMatch(/codechart:end -->\n\nAdded later\.$/);
  });

  it('saves nothing when a newer push arrived while drawing', async () => {
    const review = fakeReview(`Text.\n\n${section()}`, { body: `Text.\n\n${section()}`, head: 'abcdef123' });
    expect(await sync(review)).toBe('codechart: skipped: PR #1 moved on to abcdef1; the run for it draws the map\n');
    expect(review.svg).toBeUndefined();
    expect(review.saved).toBeUndefined();
  });

  it('saves nothing when the spec was edited while drawing', async () => {
    const review = fakeReview(`Text.\n\n${section()}`, `Text.\n\n${section()}`, `Text.\n\n${section('src/later.ts')}`);
    expect(await sync(review)).toContain('skipped: the map spec in PR #1 changed while drawing');
    expect(review.saved).toBeUndefined();
  });

  it('checks paths and anchors at the head commit, not the checked-out tree', async () => {
    writeFileSync(join(sb.repo, 'src', 'inv.ts'), 'export const invoice = 1;\n');
    git(sb.repo, 'commit', '-q', '-am', 'anchor');
    // A merge checkout can hold a different version of the file than the PR head.
    writeFileSync(join(sb.repo, 'src', 'inv.ts'), 'changed on the base branch\n');
    const anchored = { ...spec('src/inv.ts'), nodes: [{ ...spec('src/inv.ts').nodes[0]!, match: 'export const invoice' }] };
    const review = fakeReview(`Text.\n\n${prBlock(anchored, undefined, 'old.svg')}`);
    await sync(review);
    expect(review.saved).toContain('✓ 1 node checked against the code');
  });

  it('only the image link gets the published URL, never the saved spec', async () => {
    const review = fakeReview(`${section('src/inv.ts', { omitted: ['codechart-image-x.svg'] })}`);
    await sync(review);
    expect(specInDescription(review.saved!)).toEqual({ ...spec('src/inv.ts'), omitted: ['codechart-image-x.svg'] });
  });

  it('leaves the section alone when the repo turns map output off', async () => {
    writeFileSync(join(sb.repo, '.codechart.yaml'), 'defaults:\n  output: none\n');
    const review = fakeReview(`Text.\n\n${section()}`);
    expect(await sync(review)).toContain("map output is off in this repo's config");
    expect(review.saved).toBeUndefined();
  });

  it('leaves a description without a map alone', async () => {
    const review = fakeReview('Just text.');
    expect(await sync(review)).toContain('has no codechart map in its description');
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
      return new Response(JSON.stringify({ body: 'old', head: { sha: 'h2' } }), { status: 200 });
    }) as typeof fetch;
    const review = githubReview({ GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' }, sb.repo, fake);
    expect([review.name, review.base, review.head]).toEqual(['PR #5', 'b1', 'h1']);
    expect(await review.current()).toEqual({ body: 'old', head: 'h2' });
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
      const json = url.endsWith('/uploads') ? { url: '/uploads/x/map.svg' } : { description: 'body', sha: 'h2' };
      return new Response(JSON.stringify(json), { status: 200 });
    }) as typeof fetch;
    const review = gitlabReview(env, fake);
    expect([review.base, review.head, review.name]).toEqual(['b1', 'h1', 'MR !7']);
    expect(await review.current()).toEqual({ body: 'body', head: 'h2' });
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
