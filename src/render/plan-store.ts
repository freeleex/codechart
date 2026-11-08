import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitBranch, gitHead, gitIsAncestor } from '../rules/git-files.js';
import type { FlowSpec } from '../spec/flow.js';
import { validateSpec, type Spec } from '../spec/schema.js';
import { repoFolder } from './output-path.js';
import { privateDir } from './web/write.js';

const MAX_AGE_MS = 7 * 86_400_000;

export type StoredPlan =
  | { diagram: 'map'; spec: Spec; base: string; savedAt: string }
  | { diagram: 'flow'; spec: FlowSpec; base: string; savedAt: string };

export interface PlanStoreOptions {
  /** `web.outDir`: plans live in its `plans/` folder, beside the HTML. */
  cacheDir: string;
  root: string;
  now: Date;
}

/** One safe path segment; a name that needed changing gets a hash so `a/b` and `a_b` stay apart. */
function branchSegment(branch: string): string {
  const safe = branch.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '_').slice(0, 60);
  return safe === branch ? safe : `${safe}-${createHash('sha256').update(branch).digest('hex').slice(0, 6)}`;
}

const fileName = (diagram: 'map' | 'flow') => `${diagram}.json`;

function branchDir(o: PlanStoreOptions): string | undefined {
  const branch = gitBranch(o.root);
  return !branch || branch === '(detached)' ? undefined : join(o.cacheDir, 'plans', repoFolder(o.root), branchSegment(branch));
}

const entries = (dir: string) => {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

const remove = (path: string, rm: (p: string) => void): void => {
  try {
    rm(path);
  } catch {
    // Already gone, not removable, or still holds something: leave it.
  }
};

const folders = (dir: string): string[] => entries(dir).filter((e) => e.isDirectory()).map((e) => join(dir, e.name));

/** Removes plan files older than the age limit, and the folders left empty. */
function prunePlans(cacheDir: string, now: Date): void {
  const old = (file: string) => now.getTime() - statSync(file).mtimeMs > MAX_AGE_MS;
  for (const repo of folders(join(cacheDir, 'plans'))) {
    for (const branch of folders(repo)) {
      for (const file of entries(branch).filter((e) => e.isFile())) {
        remove(join(branch, file.name), (f) => old(f) && rmSync(f));
      }
      remove(branch, rmdirSync);
    }
    remove(repo, rmdirSync);
  }
}

/** A private temp file beside `file`, renamed into place: a reader or a crash never sees half a plan, and a failure leaves the old one. */
function writeAtomically(file: string, text: string): void {
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, text, { mode: 0o600, flag: 'wx' });
    renameSync(temp, file);
  } catch (e) {
    remove(temp, rmSync);
    throw e;
  }
}

/** Keeps `spec` (a plan) for the summary that follows it on this branch. Never throws: drift is best-effort. */
export function savePlan(o: PlanStoreOptions, spec: Spec | FlowSpec): void {
  try {
    const dir = branchDir(o);
    const base = gitHead(o.root);
    if (!dir || !base) return;
    privateDir(dir);
    writeAtomically(join(dir, fileName(spec.diagram === 'flow' ? 'flow' : 'map')), JSON.stringify({ spec, base, savedAt: o.now.toISOString() }));
    prunePlans(o.cacheDir, o.now);
  } catch {
    // The render goes on without a saved plan.
  }
}

/** The plan saved on this branch, if it is a week old at most and built on commits HEAD still has. With `start` (a full sha), the summary's range must start there or before the plan's commit. Never throws. */
export function loadPlan(o: PlanStoreOptions, diagram: 'map' | 'flow', start?: string): StoredPlan | undefined {
  try {
    const dir = branchDir(o);
    if (!dir) return undefined;
    const saved = JSON.parse(readFileSync(join(dir, fileName(diagram)), 'utf8')) as { spec?: unknown; base?: unknown; savedAt?: unknown };
    const { base, savedAt } = saved;
    if (typeof base !== 'string' || typeof savedAt !== 'string') return undefined;
    const age = o.now.getTime() - Date.parse(savedAt);
    if (!(age <= MAX_AGE_MS) || !gitIsAncestor(o.root, base)) return undefined;
    if (start !== undefined && !gitIsAncestor(o.root, start, base)) return undefined;
    const checked = validateSpec(saved.spec);
    if (!checked.ok || checked.spec.kind !== 'plan') return undefined;
    const { spec } = checked;
    if (spec.diagram === 'flow') return diagram === 'flow' ? { diagram, spec, base, savedAt } : undefined;
    return diagram === 'map' ? { diagram, spec, base, savedAt } : undefined;
  } catch {
    return undefined;
  }
}
