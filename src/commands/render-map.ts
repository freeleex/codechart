import { checkMapNodes } from '../render/check.js';
import { fullMapLine, KEY, renderTerminalDetailed } from '../render/terminal/render.js';
import { alertLine } from '../render/terminal/check-lines.js';
import { selectTerminalNodes } from '../render/terminal/select.js';
import { markdownBlock } from '../render/markdown.js';
import { needsWeb } from '../render/output-path.js';
import { nodePreviews } from '../render/preview.js';
import { renderHtml } from '../render/web/html.js';
import { layoutSpec, PANE_CANVASES } from '../render/web/layout.js';
import { hasNowAfter } from '../render/web/states.js';
import { diffRange } from '../rules/selection.js';
import type { Spec } from '../spec/schema.js';
import { chooseOutput, type RenderContext, type Rendered } from './choose-output.js';

function markdown(map: string | undefined, htmlPath: string | undefined, alert: string): string {
  const body = map !== undefined && htmlPath ? map.split('\n').filter((l) => l !== fullMapLine(htmlPath)).join('\n') : map;
  return markdownBlock(`**Map** _(${KEY})_`, body ?? (alert || undefined), htmlPath);
}

export async function renderMap(spec: Spec, ctx: RenderContext): Promise<Rendered> {
  const { root, diff } = ctx;
  const check = checkMapNodes(spec, root, { at: ctx.at, cwd: ctx.cwd, diff });
  const { hidden } = selectTerminalNodes(spec, ctx.maxNodes);
  const termOpts = { maxNodes: ctx.maxNodes, keyLine: !ctx.md, color: ctx.color, width: ctx.width, check };
  const previews = () => (diff ? nodePreviews(spec, root, diff, diffRange(root, ctx.selection), check.found, ctx.cwd) : undefined);
  const canvases = hasNowAfter(spec) ? PANE_CANVASES : undefined;
  const chosen = await chooseOutput(
    ctx.output,
    needsWeb(spec, hidden, ctx.minNodes),
    (htmlPath) => renderTerminalDetailed(spec, { ...termOpts, htmlPath }),
    () => ctx.write(async (meta) => renderHtml(spec, await layoutSpec(spec, canvases), meta, check, previews())),
  );
  const alert = alertLine(check, ctx.width);
  if (chosen.kind === 'web') {
    const text = ctx.md ? markdown(undefined, chosen.html.file, alert) : `${alert ? `${alert}\n` : ''}${fullMapLine(chosen.html.file)}\n`;
    return { text, check, html: chosen.html };
  }
  return { text: ctx.md ? markdown(chosen.text, chosen.html?.file, alert) : chosen.text, check, html: chosen.html };
}
