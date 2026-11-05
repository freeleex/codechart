import { chmodSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { Config, Theme } from '../../config/schema.js';
import { htmlOutputPath, repoFolder } from '../output-path.js';
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
}

export interface WrittenHtml {
  file: string;
  /** The page was written but the browser could not be launched. */
  openFailed: boolean;
}

export type WriteHtml = (build: (meta: HtmlMeta) => Promise<string>) => Promise<WrittenHtml>;

/** Creates `dir` readable by the user only; refuses a symlink, which could point the write anywhere. */
export function privateDir(dir: string): void {
  if (lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`${dir}: is a symlink; refusing to write`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

/** Builds the page, writes it (private dir, prune older ones for the slug) and opens it when `web.open` or `--open` say so. */
export async function writeHtml(build: (meta: HtmlMeta) => Promise<string>, o: HtmlWriteOptions): Promise<WrittenHtml> {
  const { config, now } = o;
  const file = htmlOutputPath(config, repoFolder(o.root), o.slug, now);
  const html = await build({ generatedAt: now, repo: basename(o.root), theme: o.theme, ...(o.update && { update: o.update }) });
  const dir = dirname(file);
  privateDir(dir);
  writeFileSync(file, html, { mode: 0o600 });
  pruneHtml(dir, { ...config.web, now, replaceSlug: o.slug });
  const mode = config.web.open;
  if (!(o.forceOpen || mode === 'always' || (mode === 'auto' && o.inEditor))) return { file, openFailed: false };
  const failed = o.open(file);
  if (failed) o.stderr(`codechart: could not open the browser (${failed})\n`);
  return { file, openFailed: Boolean(failed) };
}
