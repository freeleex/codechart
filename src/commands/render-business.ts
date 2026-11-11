import { resolve } from 'node:path';
import { findRepoRoot, loadConfig } from '../config/load.js';
import type { Theme } from '../config/schema.js';
import type { CommandOptions } from '../program.js';
import { renderBusiness } from '../render/business/render.js';
import { openBlockedNote } from '../render/markdown.js';
import { fileSlug } from '../render/output-path.js';
import { isExplain, type BusinessSpec } from '../spec/business.js';
import { businessLinkIssues } from '../spec/business-links.js';
import { loadTechBoxes } from './business-tech.js';
import { htmlWriter } from './html-writer.js';
import { InvalidSpec } from './spec-input.js';

interface BusinessFlags {
  theme?: Theme;
  open?: boolean;
  md?: boolean;
  pr?: boolean;
  tech?: string;
}

/** Business maps are HTML-only: the output mode and the diff flags don't apply, and nothing triggers one on its own. */
export async function renderBusinessSpec(spec: BusinessSpec, o: BusinessFlags, opts: CommandOptions, cwd: string): Promise<void> {
  if (o.pr) throw new Error('business maps are not for PR descriptions');
  const root = findRepoRoot(cwd) ?? resolve(cwd);
  const config = loadConfig({ cwd, home: opts.home, env: opts.env, warn: (l) => opts.stderr(`codechart: ${l}\n`) });
  const tech = await loadTechBoxes({ file: o.tech, map: spec.map, explain: isExplain(spec), cwd, outDir: config.web.outDir, root });
  const issues = businessLinkIssues(spec, tech);
  if (issues.length) throw new InvalidSpec(issues);
  const now = opts.now?.() ?? new Date();
  const write = htmlWriter({ config, root, slug: fileSlug(spec.title, 'business'), theme: o.theme, now, open: o.open }, opts);
  const { text, html } = await renderBusiness(spec, { md: o.md === true, tech, write });
  opts.stdout(o.md ? `${text}\n` : text);
  if (html.openFailed) opts.stdout(openBlockedNote(html.file, o.md === true));
}
