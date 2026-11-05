import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import type { CommandOptions } from '../program.js';
import { replaceSection, specInDescription } from '../pr/description.js';
import { reviewFromEnv, type Review } from '../pr/platforms.js';
import { imageHref, SPEC_OPEN } from '../render/pr.js';
import { renderCommand } from './render.js';

export interface SyncDeps {
  review?: Review;
}

// render prints this to stderr when the repo's config turns map output off.
const NOT_DRAWN = 'no map drawn';

/** Renders `spec` against the review's head: the description section, with the image at `placeholder`, and the SVG; undefined when output is off. */
async function render(spec: unknown, review: Review, placeholder: string, opts: CommandOptions, cwd: string): Promise<{ block: string; svg: string } | undefined> {
  const dir = mkdtempSync(join(tmpdir(), 'codechart-pr-'));
  const file = join(dir, 'map.svg');
  let block = '';
  let errors = '';
  try {
    const cmd = renderCommand({ ...opts, cwd, stdout: (s) => (block += s), stderr: (s) => (errors += s), stdin: async () => JSON.stringify(spec) });
    // --at: the checkout may be a merge commit, but paths and anchors must match the commit the diff ends at.
    await cmd.parseAsync(['-', '--since', review.base, '--head', review.head, '--at', review.head, '--pr', file, '--image-url', placeholder], { from: 'user' });
    if (!block && errors.includes(NOT_DRAWN)) return undefined;
    if (!block) throw new Error(errors.trim() || 'render printed nothing');
    return { block, svg: readFileSync(file, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Why the rendered map must not be saved: a newer push or an edited spec since the run started; undefined when it still fits. */
async function staleReason(review: Review, spec: unknown): Promise<string | undefined> {
  const now = await review.current();
  if (now.head !== review.head) return `${review.name} moved on to ${now.head.slice(0, 7)}; the run for it draws the map`;
  if (JSON.stringify(specInDescription(now.body)) !== JSON.stringify(spec)) return `the map spec in ${review.name} changed while drawing; the next push redraws it`;
  return undefined;
}

export async function syncReview(opts: CommandOptions, cwd: string, deps: SyncDeps = {}): Promise<void> {
  const review = deps.review ?? reviewFromEnv(opts.env ?? process.env, cwd);
  const say = (s: string) => opts.stdout(`codechart: ${s}\n`);
  const spec = specInDescription((await review.current()).body);
  if (spec === undefined) return say(`${review.name} has no codechart map in its description; nothing to do`);
  // Random, so no path or note in the spec can contain it.
  const placeholder = `codechart-image-${randomUUID()}.svg`;
  const drawn = await render(spec, review, placeholder, opts, cwd);
  if (!drawn) return say(`map output is off in this repo's config; ${review.name} left as is`);
  const before = await staleReason(review, spec);
  if (before) return say(`skipped: ${before}`);
  const url = await review.publish(drawn.svg);
  // Read again right before saving, so edits made meanwhile outside the section survive.
  const stale = await staleReason(review, spec);
  if (stale) return say(`skipped: ${stale}`);
  const cut = drawn.block.indexOf(SPEC_OPEN);
  const block = drawn.block.slice(0, cut).split(imageHref(placeholder)).join(imageHref(url)) + drawn.block.slice(cut);
  await review.setBody(replaceSection((await review.current()).body, block));
  say(`updated the map in ${review.name}`);
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
