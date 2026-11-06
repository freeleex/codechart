import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { repoFolder } from '../../src/render/output-path.js';
import { loadPlan, savePlan, type PlanStoreOptions } from '../../src/render/plan-store.js';
import { validateFlowSpec } from '../../src/spec/flow.js';
import { validateSpec, type Spec } from '../../src/spec/schema.js';
import { git, gitInit, makeTempDir, removeTempDir } from '../helpers/sandbox.js';

const DAY = 86_400_000;
const t0 = new Date('2026-11-06T10:00:00Z');

let tmp: string;
let root: string;
let cache: string;
const store = (now = t0): PlanStoreOptions => ({ cacheDir: cache, root, now });
const commit = (name: string) => {
  writeFileSync(join(root, name), name);
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', name);
};

function mapPlan(): Spec {
  const r = validateSpec({ title: 'p', kind: 'plan', nodes: [{ id: 'a', label: 'a', kind: 'other', status: 'new', layer: 'l' }], edges: [] });
  if (!r.ok || r.spec.diagram === 'flow') throw new Error('bad fixture');
  return r.spec;
}

const flowPlan = () => {
  const r = validateFlowSpec({ kind: 'plan', title: 'f', start: 's', steps: [{ id: 's', label: 'go', status: 'planned' }], links: [] });
  if (!r.ok) throw new Error('bad fixture');
  return r.spec;
};

const plansDir = () => join(cache, 'plans', repoFolder(root));

beforeEach(() => {
  tmp = makeTempDir('plans');
  root = join(tmp, 'repo');
  cache = join(tmp, 'cache');
  gitInit(root);
  git(root, 'checkout', '-q', '-b', 'work');
  commit('a');
});

afterEach(() => removeTempDir(tmp));

describe('plan store', () => {
  it('loads the plan saved on this branch, per diagram', () => {
    savePlan(store(), mapPlan());
    savePlan(store(), flowPlan());
    const map = loadPlan(store(), 'map');
    expect(map).toMatchObject({ diagram: 'map', savedAt: t0.toISOString(), base: git(root, 'rev-parse', 'HEAD').trim() });
    expect(map?.spec.title).toBe('p');
    expect(loadPlan(store(), 'flow')?.spec.title).toBe('f');
    expect(readdirSync(join(plansDir(), 'work')).sort()).toEqual(['flow.json', 'map.json']);
  });

  it('writes the file private to the user', () => {
    savePlan(store(), mapPlan());
    if (process.platform !== 'win32') expect(statSync(join(plansDir(), 'work', 'map.json')).mode & 0o777).toBe(0o600);
  });

  it('keeps plans of other branches apart and uses a safe folder for a branch with a slash', () => {
    savePlan(store(), mapPlan());
    git(root, 'checkout', '-q', '-b', 'feature/x');
    expect(loadPlan(store(), 'map')).toBeUndefined();
    savePlan(store(), mapPlan());
    const folders = readdirSync(plansDir());
    expect(folders).toContain('work');
    expect(folders.find((f) => f.startsWith('feature_x-'))).toBeDefined();
    expect(folders.every((f) => !f.includes('/'))).toBe(true);
  });

  it('still loads after more commits, but not once HEAD has moved back before the plan', () => {
    commit('b');
    savePlan(store(), mapPlan());
    commit('c');
    expect(loadPlan(store(), 'map')).toBeDefined();
    git(root, 'reset', '-q', '--hard', 'HEAD~2');
    expect(loadPlan(store(), 'map')).toBeUndefined();
  });

  it('ignores a plan a week old', () => {
    savePlan(store(), mapPlan());
    expect(loadPlan(store(new Date(t0.getTime() + 6 * DAY)), 'map')).toBeDefined();
    expect(loadPlan(store(new Date(t0.getTime() + 8 * DAY)), 'map')).toBeUndefined();
  });

  it('saves nothing on a detached HEAD, outside a repo or before the first commit', () => {
    git(root, 'checkout', '-q', '--detach');
    savePlan(store(), mapPlan());
    expect(existsSync(cache)).toBe(false);
    mkdirSync(join(tmp, 'plain'));
    savePlan({ ...store(), root: join(tmp, 'plain') }, mapPlan());
    gitInit(join(tmp, 'empty'));
    savePlan({ ...store(), root: join(tmp, 'empty') }, mapPlan());
    expect(existsSync(cache)).toBe(false);
    expect(loadPlan(store(), 'map')).toBeUndefined();
  });

  it('deletes plan files older than a week when it saves, and the folders they leave empty', () => {
    const stale = join(plansDir(), 'old', 'map.json');
    mkdirSync(join(plansDir(), 'old'), { recursive: true });
    writeFileSync(stale, '{}');
    utimesSync(stale, new Date(t0.getTime() - 8 * DAY), new Date(t0.getTime() - 8 * DAY));
    savePlan(store(), mapPlan());
    expect(existsSync(join(plansDir(), 'old'))).toBe(false);
    expect(existsSync(join(plansDir(), 'work', 'map.json'))).toBe(true);
  });

  it('returns nothing for a damaged or tampered file, never throwing', () => {
    savePlan(store(), mapPlan());
    const file = join(plansDir(), 'work', 'map.json');
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    for (const bad of ['{nope', JSON.stringify({ ...saved, base: '--output=x' }), JSON.stringify({ ...saved, spec: { title: 1 } }), JSON.stringify({ ...saved, savedAt: 5 })]) {
      writeFileSync(file, bad);
      expect(loadPlan(store(), 'map')).toBeUndefined();
    }
  });

  it('never throws when the cache cannot be written', () => {
    writeFileSync(cache, 'a file where the folder should be');
    expect(() => savePlan(store(), mapPlan())).not.toThrow();
  });
});
