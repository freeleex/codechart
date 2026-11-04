import type { Output } from '../config/schema.js';
import type { CheckSummary } from '../render/terminal/check-lines.js';
import type { Diff } from '../render/check.js';
import type { WrittenHtml, WriteHtml } from '../render/web/write.js';
import type { GitSelection } from '../rules/selection.js';

/** What a render command needs besides the spec; the same for maps and flows. */
export interface RenderContext {
  output: Exclude<Output, 'none'>;
  minNodes: number;
  maxNodes: number;
  width: number;
  color: boolean;
  md: boolean;
  root: string;
  cwd: string;
  at?: string;
  diff?: Diff;
  /** Changed files a summary map need not show. */
  unmapped?: (file: string) => boolean;
  /** A summary rendered in a repo without a diff flag. */
  diffUnchecked?: boolean;
  selection: GitSelection;
  write: WriteHtml;
}

export interface Rendered {
  /** What goes to stdout. */
  text: string;
  check: CheckSummary;
  html?: WrittenHtml;
}

type Terminal = { text: string; truncated: boolean };

export type Chosen = { kind: 'web'; html: WrittenHtml } | { kind: 'terminal'; text: string; html?: WrittenHtml };

/**
 * `web`: HTML only. Otherwise the terminal text, with the HTML written too for `both`, when
 * `auto` needs the web (`needsWeb`), or when the `auto` terminal text was cut short.
 * `terminal` gets the path of the page written, if any, to link it.
 */
export async function chooseOutput(
  output: RenderContext['output'],
  needsWeb: boolean,
  terminal: (htmlPath?: string) => Terminal,
  write: () => Promise<WrittenHtml>,
): Promise<Chosen> {
  if (output === 'web') return { kind: 'web', html: await write() };
  if (output === 'both' || (output === 'auto' && needsWeb)) {
    const html = await write();
    return { kind: 'terminal', text: terminal(html.file).text, html };
  }
  const plain = terminal();
  if (output !== 'auto' || !plain.truncated) return { kind: 'terminal', text: plain.text };
  const html = await write();
  return { kind: 'terminal', text: terminal(html.file).text, html };
}
