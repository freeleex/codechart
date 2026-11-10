import { resolve } from 'node:path';
import { findRepoRoot, loadConfig } from '../config/load.js';
import type { Theme } from '../config/schema.js';
import type { CommandOptions } from '../program.js';
import { openBlockedNote } from '../render/markdown.js';
import { fileSlug } from '../render/output-path.js';
import type { Brand } from '../render/release/html.js';
import { loadLogo } from '../render/release/logo.js';
import { renderRelease } from '../render/release/render.js';
import type { ReleaseSpec } from '../spec/release.js';
import { htmlWriter } from './html-writer.js';

interface ReleaseFlags {
  theme?: Theme;
  open?: boolean;
  md?: boolean;
  pr?: boolean;
  tech?: string;
}

/** The configured product name and logo; a logo that can't be used is warned about and left out, never an error. */
function brandOf(release: { product?: string; logo?: string } | undefined, root: string, warn: (line: string) => void): Brand {
  if (release?.logo === undefined) return { product: release?.product };
  const logo = loadLogo(root, release.logo);
  if ('error' in logo) warn(`release.logo "${release.logo}" ${logo.error}; the cover has no logo`);
  return { product: release.product, ...('uri' in logo && { logo: logo.uri }) };
}

/** Release maps are HTML-only, like business maps, and link to no tech map. */
export async function renderReleaseSpec(spec: ReleaseSpec, o: ReleaseFlags, opts: CommandOptions, cwd: string): Promise<void> {
  if (o.pr) throw new Error('release maps are not for PR descriptions');
  if (o.tech !== undefined) throw new Error('--tech only applies to business maps');
  const root = findRepoRoot(cwd) ?? resolve(cwd);
  const warn = (line: string) => opts.stderr(`codechart: ${line}\n`);
  const config = loadConfig({ cwd, home: opts.home, env: opts.env, warn });
  const brand = brandOf(config.release, root, warn);
  const now = opts.now?.() ?? new Date();
  const write = htmlWriter({ config, root, slug: fileSlug(spec.title, 'business'), theme: o.theme, now, open: o.open }, opts);
  const { text, html } = await renderRelease(spec, { md: o.md === true, brand, write });
  opts.stdout(o.md ? `${text}\n` : text);
  if (html.openFailed) opts.stdout(openBlockedNote(html.file, o.md === true));
}
