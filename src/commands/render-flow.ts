import { checkFlowDiff } from '../render/check.js';
import type { FlowSnippets } from '../render/flow/anchors.js';
import { renderFlowHtml } from '../render/flow/html.js';
import { layoutFlow } from '../render/flow/layout.js';
import { hasFlowNowAfter } from '../render/flow/states.js';
import { flowKey, flowMarkdown, renderFlowTree } from '../render/flow/tree.js';
import { webAlert } from '../render/terminal/check-lines.js';
import { fullMapLine } from '../render/terminal/render.js';
import type { FlowSpec } from '../spec/flow.js';
import { chooseOutput, type RenderContext, type Rendered } from './choose-output.js';

export async function renderFlow(spec: FlowSpec, anchors: { snippets: FlowSnippets; checked: number }, ctx: RenderContext): Promise<Rendered> {
  const { snippets, checked } = anchors;
  const check = { ...checkFlowDiff(spec, snippets, checked, ctx.root, ctx.diff), ...(ctx.diffUnchecked && { diffUnchecked: true }) };
  const tree = { maxNodes: ctx.maxNodes, width: ctx.width, color: ctx.color, md: ctx.md, check };
  const chosen = await chooseOutput(
    ctx.output,
    // Now and After side by side exist only in the HTML.
    spec.steps.length >= ctx.minNodes || hasFlowNowAfter(spec),
    (htmlPath) => renderFlowTree(spec, { ...tree, htmlPath }),
    () => ctx.write(async (meta) => renderFlowHtml(spec, await layoutFlow(spec), snippets, meta, check)),
  );
  if (chosen.kind === 'terminal') return { text: chosen.text, check, html: chosen.html };
  const alert = webAlert(check, ctx.width);
  const text = ctx.md
    ? flowMarkdown(spec.title, alert || undefined, { width: ctx.width, htmlPath: chosen.html.file }, flowKey(spec))
    : `${alert ? `${alert}\n` : ''}${fullMapLine(chosen.html.file)}\n`;
  return { text, check, html: chosen.html };
}
