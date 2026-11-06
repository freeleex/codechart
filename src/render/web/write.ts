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

/** Never fails the render: the page or map is what the user asked for. */
function saveReviewFile(dir: string, file: string, html: string | undefined, branch: string, o: Pick<HtmlWriteOptions, 'slug' | 'now' | 'stderr'>, snapshot: () => ReviewSnapshot): void {
  try {
    saveReview({ dir, file, html, slug: o.slug, branch, now: o.now, snapshot: snapshot() });
  } catch (e) {
    o.stderr(`codechart: Couldn't save review notes (${(e as Error).message})\n`);
  }
}

/** A map drawn without a page (terminal output) still gets its review file, where the page would have been. */
export function writeReviewOnly(snapshot: () => ReviewSnapshot, o: Pick<HtmlWriteOptions, 'config' | 'root' | 'slug' | 'now' | 'stderr'>): void {
  try {
    const dir = dirname(htmlOutputPath(o.config, repoFolder(o.root), o.slug, o.now));
    privateDir(dir);
    const branch = gitBranch(o.root);
    saveReviewFile(dir, reviewFile(htmlOutputPath(o.config, repoFolder(o.root), o.slug, o.now)), undefined, branch, o, snapshot);
    pruneHtml(dir, { ...o.config.web, now: o.now, replaceSlug: o.slug, replaceBranch: branch, pageless: true });
  } catch (e) {
    o.stderr(`codechart: Couldn't save review notes (${(e as Error).message})\n`);
  }
}

/** Builds the page, writes it (private dir, prune older ones for the slug) and opens it when `web.open` or `--open` say so. */
export async function writeHtml(build: (meta: HtmlMeta) => Promise<string>, o: HtmlWriteOptions): Promise<WrittenHtml> {
  const { config, now } = o;
  const file = htmlOutputPath(config, repoFolder(o.root), o.slug, now);
  const html = await build({ generatedAt: now, repo: basename(o.root), repoKey: repoFolder(o.root), theme: o.theme, ...(o.update && { update: o.update, updateNotes: o.updateNotes }) });
  const dir = dirname(file);
  privateDir(dir);
  writeFileSync(file, html, { mode: 0o600 });
  const branch = gitBranch(o.root);
  if (o.review) saveReviewFile(dir, reviewFile(file), file, branch, o, o.review);
  pruneHtml(dir, { ...config.web, now, replaceSlug: o.slug, replaceBranch: branch });
  const mode = config.web.open;
  if (!(o.forceOpen || mode === 'always' || (mode === 'auto' && o.inEditor))) return { file, openFailed: false };
  const failed = o.open(file);
  if (failed) o.stderr(`codechart: could not open the browser (${failed})\n`);
  return { file, openFailed: Boolean(failed) };
}
