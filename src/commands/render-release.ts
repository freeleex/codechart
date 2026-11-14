import { resolve } from 'node:path';
import { findRepoRoot, loadConfig } from '../config/load.js';
import type { Theme } from '../config/schema.js';
import { originRemote } from '../pr/merged.js';
import type { CommandOptions } from '../program.js';
import { markdownBlock, openBlockedNote } from '../render/markdown.js';
import { fullMapLine } from '../render/terminal/render.js';
import type { Brand } from '../render/release/html.js';
import { loadLogo } from '../render/release/logo.js';
import { releaseSummary, renderRelease } from '../render/release/render.js';
import { releaseSlug } from '../render/release/slug.js';
import type { ReleaseSpec } from '../spec/release.js';
import { htmlWriter } from './html-writer.js';
import { UsageError } from './usage-error.js';
import { findBrowser, pdfFlagPath, printPdf, runBrowser } from './release-pdf.js';

interface ReleaseFlags {
  theme?: Theme;
  open?: boolean;
  md?: boolean;
  pr?: boolean;
  tech?: string;
  pdf?: string;
}

/** The configured product name, else the repo's name on its forge (a worktree's folder name is often something else). */
const productOf = (release: { product?: string } | undefined, root: string): string | undefined =>
  release?.product ?? originRemote(root)?.path.split('/').pop()?.replace(/\.git$/, '');

/** The configured product name and logo; a logo that can't be used is warned about and left out, never an error. */
function brandOf(release: { product?: string; logo?: string } | undefined, root: string, warn: (line: string) => void): Brand {
  const product = productOf(release, root);
  if (release?.logo === undefined) return { product };
  const logo = loadLogo(root, release.logo);
  if ('error' in logo) warn(`release.logo "${release.logo}" ${logo.error}; the cover has no logo`);
  return { product, ...('uri' in logo && { logo: logo.uri }) };
}

/** Release maps are HTML pages printed to a PDF; the page is kept when there is no browser or it fails. */
export async function renderReleaseSpec(spec: ReleaseSpec, o: ReleaseFlags, opts: CommandOptions, cwd: string): Promise<void> {
  if (o.pr) throw new UsageError('release maps are not for PR descriptions');
  if (o.tech !== undefined) throw new UsageError('--tech only applies to business maps');
  const root = findRepoRoot(cwd) ?? resolve(cwd);
  const warn = (line: string) => opts.stderr(`codechart: ${line}\n`);
  const config = loadConfig({ cwd, home: opts.home, env: opts.env, warn });
  const brand = brandOf(config.release, root, warn);
  const now = opts.now?.() ?? new Date();
  const flagged = o.pdf === undefined ? undefined : pdfFlagPath(o.pdf, cwd);
  const write = htmlWriter({ config, root, slug: releaseSlug(spec.version, spec.title), theme: o.theme, now, open: o.open }, opts);
  const html = await renderRelease(spec, { brand, write });
  const md = o.md === true;
  const pdf = flagged ?? html.file.replace(/\.html$/, '.pdf');
  const browser = (opts.pdf?.find ?? ((configured?: string) => findBrowser({ configured, env: opts.env })))(config.release.browser);
  const failure = browser === undefined ? 'no Chromium-based browser found' : await printPdf(browser, html.file, pdf, opts.pdf?.run ?? runBrowser);
  const made = failure === undefined;
  if (!made) warn(`no PDF (${failure}): open ${html.file} in a browser and use Save as PDF, or set release.browser to a Chrome, Chromium, Edge or Brave path in your global config`);
  const summary = releaseSummary(spec);
  const pdfLine = made ? `PDF: ${pdf}` : undefined;
  opts.stdout(md ? markdownBlock('**Release map**', [summary, pdfLine].filter(Boolean).join('\n'), html.file) : `${[summary, pdfLine, fullMapLine(html.file)].filter(Boolean).join('\n')}\n`);
  if (html.openFailed) opts.stdout(openBlockedNote(html.file, md));
}
