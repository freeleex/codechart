import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git, makeSandbox, removeSandbox, repoFromTemplate, runCli, type Sandbox } from '../helpers/sandbox.js';

let sb: Sandbox;
const planned = new Date(2026, 10, 6, 10, 0, 0);
const built = new Date(2026, 10, 6, 12, 0, 0);

function seed(dir: string) {
  writeFileSync(join(dir, 'app.ts'), 'one\ntwo\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
}

beforeEach(() => {
  sb = makeSandbox('drift', { htmlOut: true });
  repoFromTemplate(sb.repo, seed);
});
afterEach(() => removeSandbox(sb.tmp));

const node = (id: string, status: string) => ({ id, label: id, kind: 'other', status, layer: 'l' });
const mapSpec = (kind: string, nodes: unknown[], extra: Record<string, unknown> = {}) => ({ title: 'Teams', kind, nodes, edges: [], ...extra });
const flowSpec = (kind: string, steps: unknown[], links: unknown[], extra: Record<string, unknown> = {}) => ({ title: 'Invite', kind, start: 'a', steps, links, ...extra });
const step = (id: string, status: string) => ({ id, label: id, status, ...(status === 'planned' ? {} : { source: 'app.ts:1' }) });

function specFile(spec: unknown): string {
  const file = join(sb.tmp, 'spec.json');
  writeFileSync(file, JSON.stringify(spec));
  return file;
}

const run = (spec: unknown, now: Date, ...args: string[]) => {
  process.exitCode = undefined;
  return runCli({ cwd: sb.repo, home: sb.home, now: () => now, isTTY: false }, ['render', specFile(spec), ...args]);
};
const plan = (spec: unknown, ...args: string[]) => run(spec, planned, ...args);
const summary = (spec: unknown, ...args: string[]) => run(spec, built, ...args);

const PLAN = mapSpec('plan', [node('a', 'new'), node('b', 'new')]);
const DRIFTED = mapSpec('summary', [node('a', 'new'), node('c', 'new')], { drift: [{ node: 'b', cause: 'bug-found', why: 'locking was needed' }] });

describe('render: plan vs built drift', () => {
  it('prints nothing about drift without a saved plan', async () => {
    const r = await summary(DRIFTED, '--output', 'cli');
    expect(r.out).not.toMatch(/Plan vs built|built as planned/);
  });

  it('a plan prints no drift, and the summary after it lists what drifted above the footer', async () => {
    expect((await plan(PLAN, '--output', 'cli')).out).not.toContain('Plan vs built');
    const r = await summary(DRIFTED, '--output', 'cli');
    const lines = r.out.split('\n');
    const at = lines.indexOf('Plan vs built (plan "Teams", drawn 2h ago)');
    expect(lines.slice(at, at + 5)).toEqual([
      'Plan vs built (plan "Teams", drawn 2h ago)',
      '− b  in the plan, not built · why: found a bug',
      '    “locking was needed”',
      '✗ c  built, not in the plan · no reason given',
      '',
    ]);
    expect(at).toBeLessThan(lines.findIndex((l) => /^\d+ nodes/.test(l)));
  });

  it('says so when the build matches the plan', async () => {
    await plan(PLAN, '--output', 'cli');
    expect((await summary(mapSpec('summary', [node('a', 'new'), node('b', 'new')]), '--output', 'cli')).out).toContain('built as planned ✓ (plan "Teams")');
  });

  it('warns about a reason for something that did not drift', async () => {
    await plan(PLAN, '--output', 'cli');
    const spec = mapSpec('summary', [node('a', 'new'), node('b', 'new')], { drift: [{ node: 'zzz', cause: 'other', why: 'x' }] });
    expect((await summary(spec, '--output', 'cli')).out).toContain('⚠ reasons without drift: zzz');
  });

  it('--strict exits 1 for drift without a reason and 0 once explained', async () => {
    await plan(PLAN, '--output', 'cli');
    expect((await summary(DRIFTED, '--output', 'cli')).code).toBeUndefined();
    expect((await summary(DRIFTED, '--output', 'cli', '--strict')).code).toBe(1);
    const explained = mapSpec('summary', [node('a', 'new'), node('c', 'new')], {
      drift: [{ node: 'b', cause: 'bug-found', why: 'x' }, { node: 'c', cause: 'user-asked', why: 'y' }],
    });
    const r = await summary(explained, '--output', 'cli', '--strict');
    expect(r.code).toBeUndefined();
    expect(r.out).toContain('+ c  built, not in the plan · why: you asked for it\n    “y”');
  });

  it('shows the block with the link when the map went to the web, and in --md', async () => {
    await plan(PLAN, '--output', 'cli');
    const web = await summary(DRIFTED, '--output', 'web');
    expect(web.out).toMatch(/^diff not checked\n\nPlan vs built \(plan "Teams", drawn 2h ago\)\n− b .*\n.*\n✗ c .*\nfull map → file:/);
    const md = await summary(DRIFTED, '--output', 'web', '--md');
    expect(md.out).toMatch(/```diff\n[^`]*Plan vs built \(plan "Teams", drawn 2h ago\)\n− b [^`]*```/);
    expect(md.out).toContain('[Open full map]');
    const both = await summary(DRIFTED, '--md');
    expect(both.out).toContain('Plan vs built (plan "Teams", drawn 2h ago)');
  });

  it('flows drift the same way: a planned step, an unplanned one, and a planned link', async () => {
    await plan(flowSpec('plan', [step('a', 'existing'), step('b', 'planned')], [{ from: 'a', to: 'b' }]), '--output', 'cli');
    const spec = flowSpec('summary', [step('a', 'existing'), step('n', 'new')], [{ from: 'a', to: 'n' }], { drift: [{ step: 'b', cause: 'cleaner-way', why: 'merged' }] });
    const r = await summary(spec, '--output', 'cli', '--strict');
    expect(r.out).toContain('Plan vs built (plan "Invite", drawn 2h ago)\n− b  in the plan, not built · why: found a cleaner way\n    “merged”\n✗ n  built, not in the plan · no reason given');
    expect(r.code).toBe(1);
  });

  describe('run from a subfolder', () => {
    const pkg = () => join(sb.repo, 'pkg');
    const fromPkg = (spec: unknown, now: Date) => {
      process.exitCode = undefined;
      return runCli({ cwd: pkg(), home: sb.home, now: () => now, isTTY: false }, ['render', specFile(spec), '--output', 'cli']);
    };
    const withPkg = (rootFile: boolean) => {
      mkdirSync(pkg());
      writeFileSync(join(pkg(), 'b.ts'), 'one\ntwo\nthree\n');
      if (rootFile) writeFileSync(join(sb.repo, 'b.ts'), 'one\ntwo\nthree\n');
    };
    const at = (id: string, path: string, status = 'new') => ({ ...node(id, status), path });

    it('a cwd-relative path in the plan pairs with the repo-root path in the summary', async () => {
      withPkg(false);
      await fromPkg(mapSpec('plan', [at('a', 'b.ts')]), planned);
      expect((await fromPkg(mapSpec('summary', [at('z', 'pkg/b.ts')]), built)).out).toContain('built as planned ✓');
    });

    it('stays a different file when the repo root has that file too', async () => {
      withPkg(true);
      await fromPkg(mapSpec('plan', [at('a', 'b.ts')]), planned);
      const out = (await fromPkg(mapSpec('summary', [at('a', 'pkg/b.ts')]), built)).out;
      expect(out).not.toContain('built as planned');
      expect(out).toContain('path b.ts → pkg/b.ts');
    });

    it('flow steps pair the same way', async () => {
      withPkg(false);
      const link = (to: string) => [{ from: 'a', to }];
      const first = { ...step('a', 'existing'), source: 'b.ts:1' };
      await fromPkg(flowSpec('plan', [first, { ...step('b', 'planned'), source: 'b.ts:3' }], link('b')), planned);
      const r = await fromPkg(flowSpec('summary', [first, { ...step('n', 'new'), source: 'pkg/b.ts:3' }], link('n')), built);
      expect(r.out).toContain('built as planned ✓');
    });
  });

  it('keeps a map plan and a flow plan apart', async () => {
    await plan(PLAN, '--output', 'cli');
    const r = await summary(flowSpec('summary', [step('a', 'existing')], []), '--output', 'cli');
    expect(r.out).not.toMatch(/Plan vs built|built as planned/);
  });

  it('a summary of another target (--at or --head) gets no plan: the branch\'s plan and HEAD don\'t apply to it', async () => {
    await plan(PLAN, '--output', 'cli');
    const here = await summary(DRIFTED, '--output', 'cli');
    expect(here.out).toContain('Plan vs built');
    for (const args of [['--at', 'HEAD'], ['--since', 'HEAD', '--head', 'HEAD']]) {
      const r = await summary(DRIFTED, '--output', 'cli', ...args);
      expect(r.out, args.join(' ')).not.toMatch(/Plan vs built|built as planned/);
    }
  });

  it('a summary gets the plan only when its range starts at the plan\'s commit or before', async () => {
    const commitFile = (name: string) => {
      writeFileSync(join(sb.repo, name), name);
      git(sb.repo, 'add', '.');
      git(sb.repo, 'commit', '-q', '-m', name);
    };
    const gets = async (...args: string[]) => /Plan vs built|built as planned/.test((await summary(DRIFTED, '--output', 'cli', ...args)).out);
    await plan(PLAN, '--output', 'cli');
    const planned = git(sb.repo, 'rev-parse', 'HEAD').trim();
    commitFile('b.ts');
    const work = git(sb.repo, 'rev-parse', 'HEAD').trim();
    expect(await gets('--git'), '--git after the work').toBe(false);
    commitFile('c.ts');
    expect(await gets('--commit', 'HEAD'), '--commit of an unrelated commit').toBe(false);
    expect(await gets('--git'), '--git at HEAD').toBe(false);
    expect(await gets('--since', work), '--since after the plan').toBe(false);
    expect(await gets('--since', planned), '--since the plan').toBe(true);
    expect(await gets('--commit', work), '--commit of the work').toBe(true);
    expect(await gets(), 'no diff flag').toBe(true);
  });

  it('saves no plan for --pr, --at or a repo-less folder', async () => {
    const plans = join(sb.out, 'plans');
    await plan(PLAN, '--pr');
    await plan(PLAN, '--output', 'cli', '--at', 'HEAD');
    expect(existsSync(plans)).toBe(false);
    await plan(PLAN, '--output', 'cli');
    expect(existsSync(plans)).toBe(true);
  });

  it('a later plan on the same branch replaces the earlier one', async () => {
    await plan(PLAN, '--output', 'cli');
    await plan(mapSpec('plan', [node('a', 'new')]), '--output', 'cli');
    expect((await summary(mapSpec('summary', [node('a', 'new')]), '--output', 'cli')).out).toContain('built as planned ✓');
  });
});
