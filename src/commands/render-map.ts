import { checkMapNodes } from '../render/check.js';
import { fullMapLine, KEY, renderTerminalDetailed } from '../render/terminal/render.js';
import { alertLine, webAlert } from '../render/terminal/check-lines.js';
import { selectTerminalNodes } from '../render/terminal/select.js';
import { markdownBlock } from '../render/markdown.js';
import { writeFileSync } from 'node:fs';
import { prBlock, renderSvg } from '../render/pr.js';
import { nodePreviews } from '../render/preview.js';
import { renderHtml } from '../render/web/html.js';
import { DESCRIPTION_CANVASES, layoutSpec, PANE_CANVASES } from '../render/web/layout.js';
import { hasNowAfter } from '../render/web/states.js';
import { mapSnapshot, rangeOf } from '../review/snapshot.js';
import { diffRange } from '../rules/selection.js';
import type { Spec } from '../spec/schema.js';
import { chooseOutput, type RenderContext, type Rendered } from './choose-output.js';

function markdown(map: string | undefined, htmlPath: string | undefined, alert: string): string {
  const body = map !== undefined && htmlPath ? map.split('\n').filter((l) => l !== fullMapLine(htmlPath)).join('\n') : map;
  return markdownBlock(`**Map** _(${KEY})_`, body ?? (alert || undefined), htmlPath, 'diff');
}

// Now and After side by side exist only in the HTML.
const needsWeb = (spec: Spec, hidden: number, minNodes: number): boolean => hidden > 0 || spec.nodes.length >= minNodes || hasNowAfter(spec);

export async function renderMap(spec: Spec, ctx: RenderContext): Promise<Rendered> {
  const { root, diff } = ctx;
  const check = { ...checkMapNodes(spec, root, { at: ctx.at, cwd: ctx.cwd, diff, ignored: ctx.unmapped }), ...(ctx.diffUnchecked && { diffUnchecked: true }) };
  if (ctx.pr) {
    writeFileSync(ctx.pr.svg, renderSvg(spec, await layoutSpec(spec, DESCRIPTION_CANVASES), check), { mode: 0o600 });
    return { text: prBlock(spec, check, ctx.pr.imageUrl), check };
  }
  const { hidden } = selectTerminalNodes(spec, ctx.maxNodes);
  const termOpts = { maxNodes: ctx.maxNodes, keyLine: !ctx.md, color: ctx.color, width: ctx.width, check };
  let cached: ReturnType<typeof nodePreviews> | undefined;
  const previews = () => (diff ? (cached ??= nodePreviews(spec, root, diff, diffRange(root, ctx.selection), check.found, ctx.cwd)) : undefined);
  const snapshot = () => mapSnapshot(spec, previews(), rangeOf(root, ctx.selection));
  const canvases = hasNowAfter(spec) ? PANE_CANVASES : undefined;
  const chosen = await chooseOutput(
    ctx.output,
    needsWeb(spec, hidden, ctx.minNodes),
    (htmlPath) => renderTerminalDetailed(spec, { ...termOpts, htmlPath }),
    () => ctx.write(async (meta) => renderHtml(spec, await layoutSpec(spec, canvases), meta, check, previews()), snapshot),
  );
  if (!chosen.html) ctx.saveReview(snapshot);
  if (chosen.kind === 'web') {
    const alert = webAlert(check, ctx.width);
    const text = ctx.md ? markdown(undefined, chosen.html.file, alert) : `${alert ? `${alert}\n` : ''}${fullMapLine(chosen.html.file)}\n`;
    return { text, check, html: chosen.html };
  }
  return { text: ctx.md ? markdown(chosen.text, chosen.html?.file, alertLine(check, ctx.width)) : chosen.text, check, html: chosen.html };
}
