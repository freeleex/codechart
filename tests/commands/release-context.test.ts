import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prBlock } from '../../src/render/pr.js';
import type { Spec } from '../../src/spec/schema.js';
import { git, makeSandbox, removeSandbox, runCli, type Sandbox } from '../helpers/sandbox.js';

const spec: Spec = {
  title: 'Invoices',
  kind: 'summary',
  nodes: [{ id: 'inv', label: 'invoice service', kind: 'service', status: 'new', layer: 'backend', path: 'src/inv.ts' }],
  edges: [],
};

interface Out {
  since: string;
  sinceSha: string;
  head: string;
  version?: string;
  changes: { sha: string; title: string; date: string; pr?: number; files: string[]; moreFiles?: number; prTitle?: string; description?: string; map?: unknown }[];
  notes?: string[];
}

describe('codechart release-context', () => {
  let sb: Sandbox;
  const commit = (msg: string, files: Record<string, string> = { [`f${Math.random()}.txt`]: 'x' }) => {
    for (const [f, c] of Object.entries(files)) writeFileSync(join(sb.repo, f), c);
    git(sb.repo, 'add', '-A');
    git(sb.repo, 'commit', '-q', '-m', msg);
  };
  const run = (args: string[] = [], tool?: (c: string, a: string[]) => string) => runCli({ cwd: sb.repo, home: sb.home, tool }, ['release-context', ...args]);
  const json = async (args: string[] = [], tool?: (c: string, a: string[]) => string) => JSON.parse((await run(args, tool)).out) as Out;

  beforeEach(() => {
    sb = makeSandbox('release-context', { git: 'init' });
    commit('base', { 'package.json': '{"version":"1.0.0"}' });
    git(sb.repo, 'tag', 'v1.0.0');
  });
  afterEach(() => removeSandbox(sb.tmp));

  it('defaults to the newest v* tag before HEAD and lists first-parent commits oldest first', async () => {
    commit('one (#12)', { 'a.txt': '1' });
    git(sb.repo, 'tag', 'v1.1.0');
    git(sb.repo, 'tag', 'not-a-release');
    commit('two (#13)', { 'b.txt': '2' });
    commit('three', { 'c.txt': '3' });
    const out = await json();
    expect(out.since).toBe('v1.1.0');
    expect(out.version).toBe('1.0.0');
    expect(out.changes.map((c) => c.title)).toEqual(['two (#13)', 'three']);
    expect(out.changes[0]).toMatchObject({ pr: 13, files: ['b.txt'] });
    expect(out.changes[1]!.pr).toBeUndefined();
    expect(out.head).toBe(git(sb.repo, 'rev-parse', 'HEAD').trim());
    expect(out.sinceSha).toBe(git(sb.repo, 'rev-parse', 'v1.1.0^{commit}').trim());
  });

  it('when HEAD is the tagged release, maps it against the tag before', async () => {
    commit('one (#12)', { 'a.txt': '1' });
    git(sb.repo, 'tag', 'v1.1.0');
    const out = await json();
    expect(out.since).toBe('v1.0.0');
    expect(out.changes.map((c) => c.title)).toEqual(['one (#12)']);
  });

  it('--since overrides the tag', async () => {
    commit('one', { 'a.txt': '1' });
    git(sb.repo, 'tag', 'v1.1.0');
    commit('two', { 'b.txt': '2' });
    const out = await json(['--since', 'v1.0.0']);
    expect(out.changes.map((c) => c.title)).toEqual(['one', 'two']);
  });

  it('--head stops at another commit', async () => {
    commit('one', { 'a.txt': '1' });
    commit('two', { 'b.txt': '2' });
    const out = await json(['--head', 'HEAD~1']);
    expect(out.changes.map((c) => c.title)).toEqual(['one']);
  });

  it('without a tag and --since: a first release, from the root commit on', async () => {
    git(sb.repo, 'tag', '-d', 'v1.0.0');
    commit('second (#2)', { 'a.txt': '1' });
    const out = await json();
    expect(out.changes.map((c) => c.title)).toEqual(['base', 'second (#2)']);
    expect(out.changes[0]!.files).toEqual(['package.json']);
    expect(out.since).toBeUndefined();
    expect(out.notes).toContain('First release: no v* tag before HEAD, so this lists every commit from the start.');
  });

  it('rejects a bad ref', async () => {
    for (const args of [['--since', '--evil'], ['--since', 'nope'], ['--head', 'nope'], ['--since', 'a b']]) {
      process.exitCode = undefined;
      const r = await run(args);
      expect(r.code).toBe(2);
      expect(r.out).toBe('');
    }
  });

  it('reads the PR number from a GitHub squash title, a GitHub merge commit and a GitLab merge commit', async () => {
    commit('squash (#12)', { 'a.txt': '1' });
    git(sb.repo, 'checkout', '-q', '-b', 'topic');
    commit('topic work', { 'b.txt': '2' });
    git(sb.repo, 'checkout', '-q', '-');
    git(sb.repo, 'merge', '--no-ff', '-q', 'topic', '-m', 'Merge pull request #34 from o/topic', '-m', 'Add b');
    git(sb.repo, 'checkout', '-q', '-b', 'topic2');
    commit('more', { 'c.txt': '3' });
    git(sb.repo, 'checkout', '-q', '-');
    git(sb.repo, 'merge', '--no-ff', '-q', 'topic2', '-m', "Merge branch 'topic2' into 'main'", '-m', 'Add c', '-m', 'See merge request grp/sub/proj!56');
    const out = await json();
    expect(out.changes.map((c) => [c.title, c.pr, c.files])).toEqual([
      ['squash (#12)', 12, ['a.txt']],
      ['Add b', 34, ['b.txt']],
      ["Merge branch 'topic2' into 'main'", 56, ['c.txt']],
    ]);
  });

  it('caps the file list per change', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 45; i++) files[`f${String(i).padStart(2, '0')}.txt`] = 'x';
    commit('big', files);
    const [c] = (await json()).changes;
    expect(c!.files).toHaveLength(40);
    expect(c!.moreFiles).toBe(5);
  });

  describe('PR descriptions', () => {
    beforeEach(() => {
      git(sb.repo, 'remote', 'add', 'origin', 'git@github.com:o/r.git');
      commit('Add invoices (#7)', { 'a.txt': '1' });
    });

    it('decodes the map and drops the codechart section from the text', async () => {
      const body = `Adds invoices.\n\n${prBlock(spec, undefined, 'x.svg')}\nSee notes.`;
      const calls: string[][] = [];
      const tool = (c: string, a: string[]) => {
        calls.push([c, ...a]);
        return JSON.stringify({ title: 'Invoices, with a longer title', body });
      };
      const out = await json([], tool);
      expect(calls).toEqual([['gh', 'pr', 'view', '7', '--repo', 'o/r', '--json', 'title,body']]);
      const [c] = out.changes;
      expect(c!.map).toEqual(spec);
      expect(c!.prTitle).toBe('Invoices, with a longer title');
      expect(c!.description).toBe('Adds invoices.\n\nSee notes.');
      expect(out.notes).toBeUndefined();
    });

    it('reads GitLab merge requests with glab', async () => {
      git(sb.repo, 'remote', 'set-url', 'origin', 'https://gitlab.example.com/g/p.git');
      commit('Merge branch x', { 'b.txt': '2' });
      git(sb.repo, 'commit', '-q', '--amend', '-m', 'Add y', '-m', 'See merge request g/p!9');
      const calls: string[][] = [];
      const out = await json([], (c, a) => {
        calls.push([c, ...a]);
        return JSON.stringify({ title: 'Add y', description: 'y body' });
      });
      expect(calls.at(-1)).toEqual(['glab', 'mr', 'view', '9', '--repo', 'https://gitlab.example.com/g/p', '--output', 'json']);
      expect(out.changes.at(-1)!.description).toBe('y body');
    });

    it('falls back to git alone, with a note, when the tool fails; calls it once', async () => {
      commit('Another (#8)', { 'b.txt': '2' });
      let calls = 0;
      const out = await json([], () => {
        calls++;
        throw new Error('gh is not installed');
      });
      expect(calls).toBe(1);
      expect(out.changes.map((c) => c.pr)).toEqual([7, 8]);
      expect(out.changes.every((c) => !c.description && !c.map)).toBe(true);
      expect(out.notes).toEqual(['PR descriptions were not read: gh is not installed.']);
    });

    it('a number that is not a PR costs only that change its text, with a note', async () => {
      commit('Fix crash (#15053)', { 'b.txt': '2' });
      const out = await json([], (_c, a) => {
        if (a[2] === '15053') throw new Error('gh failed: GraphQL: Could not resolve to a PullRequest with the number of 15053.');
        return JSON.stringify({ title: 'Add invoices (#7)', body: 'Adds invoices.' });
      });
      expect(out.changes.map((c) => c.description)).toEqual(['Adds invoices.', undefined]);
      expect(out.notes).toEqual(['PR descriptions were not read for #15053: gh failed: GraphQL: Could not resolve to a PullRequest with the number of 15053.']);
    });

    it('does not call the tool when no change has a PR number', async () => {
      git(sb.repo, 'tag', 'v1.1.0');
      commit('plain', { 'b.txt': '2' });
      let calls = 0;
      const out = await json([], () => {
        calls++;
        return '{}';
      });
      expect(calls).toBe(0);
      expect(out.notes).toBeUndefined();
    });

    it('notes when origin is neither GitHub nor GitLab', async () => {
      git(sb.repo, 'remote', 'set-url', 'origin', 'git@git.example.com:o/r.git');
      const out = await json([], () => '{}');
      expect(out.notes).toEqual(['PR descriptions were not read: origin is not a GitHub or GitLab remote.']);
    });

    it('reads only the newest 50 PRs and says so', async () => {
      for (let i = 100; i < 152; i++) commit(`pr ${i} (#${i})`, { [`p${i}.txt`]: 'x' });
      let calls = 0;
      const out = await json(['--since', 'v1.0.0'], () => {
        calls++;
        return JSON.stringify({ title: 't', body: 'b' });
      });
      expect(calls).toBe(50);
      expect(out.notes).toEqual(['Only the newest 50 of 53 PRs had their descriptions read.']);
    }, 60_000);
  });
});
