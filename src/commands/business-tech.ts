import { join } from 'node:path';
import { stepKey } from '../render/explain-flows.js';
import { isExplainSlug, repoFolder } from '../render/output-path.js';
import { listReviews } from '../review/store.js';
import { gitBranch } from '../rules/git-files.js';
import { validateSpec } from '../spec/schema.js';
import type { TechBox } from '../spec/business-links.js';
import { readSpecJson } from './spec-input.js';

const NO_TECH = "no tech map found for this change: render the tech map first, or pass --tech '<spec.json>'";

const NO_EXPLAIN = 'no explain map found for this area: draw the explain map of it first (kind: "explain"), or pass --tech \'<spec.json>\'';

const noStdin = (): Promise<string> => Promise.reject(new Error('read from a file'));

export interface TechSource {
  /** `--tech`: the tech map's spec file. */
  file?: string;
  /** The business spec's `map`: file name slug of the saved tech map to use. */
  map?: string;
  cwd: string;
  /** An explain page: the boxes are those of an explain map, and of its flow steps. */
  explain?: boolean;
  /** `web.outDir`. */
  outDir: string;
  root: string;
}

/** The boxes of the tech map a business map links to: from the `--tech` spec, else the newest saved map (or the one called `map`) on this branch, never an explain map. An explain page links to explain maps only: their boxes and flow steps. */
export async function loadTechBoxes(src: TechSource): Promise<TechBox[]> {
  if (src.file !== undefined) {
    const result = validateSpec(await readSpecJson(src.file, src.cwd, noStdin));
    if (!result.ok) throw new Error(result.errors.map((e) => `--tech ${src.file}: ${e}`).join('\n'));
    const { spec } = result;
    if (src.explain) {
      if (spec.diagram === 'flow' || spec.kind !== 'explain') throw new Error(`--tech ${src.file}: an explain page needs an explain map (kind: "explain")`);
      return [...spec.nodes, ...(spec.flows ?? []).flatMap((f) => f.steps.map((s) => ({ id: stepKey(f.id, s.id), label: s.label })))].map(({ id, label }) => ({ id, label }));
    }
    return spec.diagram === 'flow' ? spec.steps.map(({ id, label }) => ({ id, label })) : spec.nodes.map(({ id, label }) => ({ id, label }));
  }
  if (src.explain) {
    try {
      const found = listReviews(join(src.outDir, repoFolder(src.root)), gitBranch(src.root)).find((f) => isExplainSlug(f.review.change.slug) && (src.map === undefined || f.review.change.slug === src.map || f.review.change.slug === `${src.map}.explain`));
      if (!found) throw new Error(NO_EXPLAIN);
      return found.review.nodes.map(({ id, label }) => ({ id, label }));
    } catch {
      throw new Error(NO_EXPLAIN);
    }
  }
  try {
    // An explain map describes code that didn't change, so it is never the map of a change.
    const found = listReviews(join(src.outDir, repoFolder(src.root)), gitBranch(src.root)).find((f) => !isExplainSlug(f.review.change.slug) && (src.map === undefined || f.review.change.slug === src.map));
    if (!found) throw new Error(NO_TECH);
    return found.review.nodes.map(({ id, label }) => ({ id, label }));
  } catch {
    throw new Error(NO_TECH);
  }
}
