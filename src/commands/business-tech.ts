import { join } from 'node:path';
import { repoFolder } from '../render/output-path.js';
import { findChange } from '../review/store.js';
import { gitBranch } from '../rules/git-files.js';
import { validateSpec } from '../spec/schema.js';
import type { TechBox } from '../spec/business-links.js';
import { readSpecJson } from './spec-input.js';

const NO_TECH = "no tech map found for this change: render the tech map first, or pass --tech '<spec.json>'";

const noStdin = (): Promise<string> => Promise.reject(new Error('read from a file'));

export interface TechSource {
  /** `--tech`: the tech map's spec file. */
  file?: string;
  /** The business spec's `map`: file name slug of the saved tech map to use. */
  map?: string;
  cwd: string;
  /** `web.outDir`. */
  outDir: string;
  root: string;
}

/** The boxes of the tech map a business map links to: from the `--tech` spec, else the newest saved map (or the one called `map`) on this branch. */
export async function loadTechBoxes(src: TechSource): Promise<TechBox[]> {
  if (src.file !== undefined) {
    const result = validateSpec(await readSpecJson(src.file, src.cwd, noStdin));
    if (!result.ok) throw new Error(result.errors.map((e) => `--tech ${src.file}: ${e}`).join('\n'));
    const { spec } = result;
    return spec.diagram === 'flow' ? spec.steps.map(({ id, label }) => ({ id, label })) : spec.nodes.map(({ id, label }) => ({ id, label }));
  }
  try {
    const { review } = findChange(join(src.outDir, repoFolder(src.root)), gitBranch(src.root), src.map, true);
    return review.nodes.map(({ id, label }) => ({ id, label }));
  } catch {
    throw new Error(NO_TECH);
  }
}
