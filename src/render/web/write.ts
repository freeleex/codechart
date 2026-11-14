import { chmodSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { Config, Theme } from '../../config/schema.js';
import { gitBranch } from '../../rules/git-files.js';
import { saveReview, type ReviewSnapshot } from '../../review/store.js';
import { htmlOutputPath, repoFolder, reviewFile } from '../output-path.js';
import { pruneHtml } from '../prune.js';
import type { HtmlMeta } from './page.js';

export interface HtmlWriteOptions {
  config: Config;
  root: string;
  slug: string;
  theme: Theme;
  now: Date;
  /** `--open`: open the page whatever `web.open` says. */
  forceOpen: boolean;
  /** Running under a code editor: `web.open: auto` then opens the page. */
  inEditor: boolean;
  open: (file: string) => string | void;
  stderr: (s: string) => void;
  /** A newer codechart version to mention in the header. */
  update?: string;
  updateNotes?: string[];
  /** The global config file, named when the output folder can't be written. */
  configPath?: string;
  /** What the page showed per node, saved as the review file next to it. */
  review?: () => ReviewSnapshot;
}

export interface WrittenHtml {
  file: string;
  /** The page was written but the browser could not be launched. */
  openFailed: boolean;
}

export type WriteHtml = (build: (meta: HtmlMeta) => Promise<string>, review?: () => ReviewSnapshot) => Promise<WrittenHtml>;

/** Creates `dir` readable by the user only; refuses a symlink, which could point the write anywhere. */
export function privateDir(dir: string): void {
  if (lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`${dir}: is a symlink; refusing to write`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

/** The output folder can't be written; the message says what to do. */
class DirNotWritable extends Error {}

function prepareDir(dir: string, configPath: string | undefined): void {
  try {
    privateDir(dir);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EACCES' && code !== 'EPERM') throw e;
    throw new DirNotWritable(`can't write to ${dir} (permission denied): fix its permissions or set web.outDir in ${configPath ?? 'your global config'}`);
  }
}

/** Never fails the render: the page or map is what the user asked for. `prune` runs once, with whether the save worked: on success inside the save, while the earlier review is still locked. */
function saveReviewFile(dir: string, review: { file: string; html?: string }, branch: string, o: Pick<HtmlWriteOptions, 'slug' | 'now' | 'stderr'>, snapshot: () => ReviewSnapshot, prune: (saved: boolean) => void): void {
  let pruned = false;
  try {
    saveReview({ dir, ...review, slug: o.slug, branch, now: o.now, snapshot: snapshot(), afterWrite: () => { pruned = true; prune(true); } });
  } catch (e) {
    o.stderr(`codechart: Couldn't save review notes (${(e as Error).message})\n`);
    if (!pruned) prune(false);
  }
}

/** A map drawn without a page (terminal output) still gets its review file, where the page would have been. */
export function writeReviewOnly(snapshot: () => ReviewSnapshot, o: Pick<HtmlWriteOptions, 'config' | 'root' | 'slug' | 'now' | 'stderr' | 'configPath'>): void {
  try {
    const dir = dirname(htmlOutputPath(o.config, repoFolder(o.root), o.slug, o.now));
    prepareDir(dir, o.configPath);
    const branch = gitBranch(o.root);
    // The earlier render holds the user's notes: it is not replaced by one that could not take them over.
    const prune = (saved: boolean) => pruneHtml(dir, { ...o.config.web, now: o.now, replaceSlug: saved ? o.slug : undefined, replaceBranch: branch, pageless: true });
    saveReviewFile(dir, { file: reviewFile(htmlOutputPath(o.config, repoFolder(o.root), o.slug, o.now)) }, branch, o, snapshot, prune);
  } catch (e) {
    o.stderr(e instanceof DirNotWritable ? `codechart: ${e.message}\n` : `codechart: Couldn't save review notes (${(e as Error).message})\n`);
  }
}

/** Builds the page, writes it (private dir, prune older ones for the slug) and opens it when `web.open` or `--open` say so. */
export async function writeHtml(build: (meta: HtmlMeta) => Promise<string>, o: HtmlWriteOptions): Promise<WrittenHtml> {
  const { config, now } = o;
  const file = htmlOutputPath(config, repoFolder(o.root), o.slug, now);
  const branch = gitBranch(o.root);
  const change = o.review && { slug: o.slug, branch, at: now.toISOString() };
  const html = await build({ generatedAt: now, repo: basename(o.root), repoKey: repoFolder(o.root), theme: o.theme, ...(o.update && { update: o.update, updateNotes: o.updateNotes }), ...(change && { change }) });
  const dir = dirname(file);
  prepareDir(dir, o.configPath);
  writeFileSync(file, html, { mode: 0o600 });
  // A failed save keeps the earlier page and review: they hold the user's notes.
  const prune = (saved: boolean) => pruneHtml(dir, { ...config.web, now, replaceSlug: saved ? o.slug : undefined, replaceBranch: branch });
  if (o.review) saveReviewFile(dir, { file: reviewFile(file), html: file }, branch, o, o.review, prune);
  else prune(true);
  const mode = config.web.open;
  if (!(o.forceOpen || mode === 'always' || (mode === 'auto' && o.inEditor))) return { file, openFailed: false };
  const failed = o.open(file);
  if (failed) o.stderr(`codechart: could not open the browser (${failed})\n`);
  return { file, openFailed: Boolean(failed) };
}
