import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import type { CommandOptions } from '../program.js';
import { replaceSection, specInDescription } from '../pr/description.js';
import { reviewFromEnv, type Review } from '../pr/platforms.js';
import { imageHref } from '../render/pr.js';
import { renderCommand } from './render.js';

const PLACEHOLDER = 'codechart-image-placeholder.svg';

export interface SyncDeps {
  review?: Review;
}

/** Renders `spec` against the review's diff: the description section, with the image still at PLACEHOLDER, and the SVG. */
async function render(spec: unknown, review: Review, opts: CommandOptions, cwd: string): Promise<{ block: string; svg: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'codechart-pr-'));
  const file = join(dir, 'map.svg');
  let block = '';
  let errors = '';
  try {
    const cmd = renderCommand({ ...opts, cwd, stdout: (s) => (block += s), stderr: (s) => (errors += s), stdin: async () => JSON.stringify(spec) });
    await cmd.parseAsync(['-', '--since', review.base, '--head', review.head, '--pr', file, '--image-url', PLACEHOLDER], { from: 'user' });
    if (!block) throw new Error(errors.trim() || 'render printed nothing');
    return { block, svg: readFileSync(file, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function syncReview(opts: CommandOptions, cwd: string, deps: SyncDeps = {}): Promise<void> {
  const review = deps.review ?? reviewFromEnv(opts.env ?? process.env, cwd);
  const body = await review.body();
  const spec = specInDescription(body);
  if (spec === undefined) {
    opts.stdout(`codechart: ${review.name} has no codechart map in its description; nothing to do\n`);
    return;
  }
  const { block, svg } = await render(spec, review, opts, cwd);
  const url = await review.publish(svg);
  await review.setBody(replaceSection(body, block.split(imageHref(PLACEHOLDER)).join(imageHref(url))));
  opts.stdout(`codechart: updated the map in ${review.name}\n`);
}

export function prSyncCommand(opts: CommandOptions): Command {
  const cwd = opts.cwd ?? process.cwd();
  return new Command('pr-sync')
    .description("CI: re-render the map in this PR or MR's description against its latest commits")
    .action(async () => {
      try {
        await syncReview(opts, cwd);
      } catch (e) {
        opts.stderr(`codechart: ${e instanceof Error ? e.message : String(e)}\n`);
        process.exitCode = 1;
      }
    });
}
