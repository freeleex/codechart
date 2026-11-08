import { join, resolve } from 'node:path';
import { findRepoRoot, loadConfig } from '../config/load.js';
import type { CommandOptions } from '../program.js';
import { repoFolder } from '../render/output-path.js';
import { gitBranch } from '../rules/git-files.js';
import { findChange, type Found, type Which } from '../review/store.js';

export interface Located extends Found {
  root: string;
}

/** The change a review command works on: the newest on this branch, or `--change <slug>`. `branch`: look there instead of the checked-out one; `exact`: `slug` must be the file name slug. `which`: as for `findChange`. */
export function locateChange(opts: CommandOptions, slug?: string, branch?: string, exact = false, which: Which = 'tech'): Located {
  const cwd = opts.cwd ?? process.cwd();
  const root = findRepoRoot(cwd) ?? resolve(cwd);
  const config = loadConfig({ cwd, home: opts.home, env: opts.env, warn: (l) => opts.stderr(`codechart: ${l}\n`) });
  return { root, ...findChange(join(config.web.outDir, repoFolder(root)), branch ?? gitBranch(root), slug, exact, which) };
}

/** Runs `fn`; an error is printed as `codechart: …` and fails the command. */
export async function guarded(opts: CommandOptions, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    opts.stderr(`codechart: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
}
