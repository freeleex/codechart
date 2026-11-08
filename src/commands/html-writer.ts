import type { Config, Theme } from '../config/schema.js';
import type { CommandOptions } from '../program.js';
import { writeHtml, type WriteHtml } from '../render/web/write.js';
import { checkAllowed, currentVersion, knownHighlights, knownUpdate, readState } from '../update/check.js';
import { inCodeEditor, openInBrowser } from './open.js';

interface WriterOptions {
  config: Config;
  root: string;
  slug: string;
  theme?: Theme;
  now: Date;
  /** `--open` */
  open?: boolean;
}

/** Writes pages for one render: the theme, the browser, and the newer-version note in the header as `render` sets them. */
export function htmlWriter(o: WriterOptions, opts: CommandOptions): WriteHtml {
  const { config } = o;
  const env = opts.env ?? process.env;
  const update = checkAllowed({ enabled: config.updateCheck, env: { ...process.env, ...env } }) ? knownUpdate(config.web.outDir) : undefined;
  return (build, review) =>
    writeHtml(build, {
      review,
      config,
      root: o.root,
      slug: o.slug,
      theme: o.theme ?? config.web.theme,
      now: o.now,
      forceOpen: o.open === true,
      inEditor: inCodeEditor(env),
      open: opts.open ?? openInBrowser,
      stderr: opts.stderr,
      update,
      updateNotes: update ? knownHighlights(readState(config.web.outDir), currentVersion(), update)?.bullets : undefined,
    });
}
