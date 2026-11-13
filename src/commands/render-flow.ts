import { checkFlowDiff } from '../render/check.js';
import { repoPathResolver, type FlowSnippets } from '../render/flow/anchors.js';
import { renderFlowHtml, withGhosts } from '../render/flow/html.js';
import { ghostsFor } from '../render/web/drift-html.js';
import { layoutFlow } from '../render/flow/layout.js';
import { hasFlowNowAfter } from '../render/flow/states.js';
import { compareFlows } from '../render/flow/drift.js';
import { flowKey, flowMarkdown, renderFlowTree } from '../render/flow/tree.js';
import { flowSnapshot, rangeOf } from '../review/snapshot.js';
import { webAlert } from '../render/terminal/check-lines.js';
import { driftBlock } from '../render/terminal/drift-lines.js';
import { fullMapLine } from '../render/terminal/render.js';
import type { FlowSpec } from '../spec/flow.js';
import { chooseOutput, type RenderContext, type Rendered } from './choose-output.js';

export async function renderFlow(spec: FlowSpec, anchors: { snippets: FlowSnippets; checked: number }, ctx: RenderContext): Promise<Rendered> {
  const { snippets, checked } = anchors;
  const check = { ...checkFlowDiff(spec, snippets, checked, ctx.root, ctx.diff), ...(ctx.diffUnchecked && { diffUnchecked: true }) };
  const drift = ctx.plan?.diagram === 'flow' ? compareFlows(ctx.plan, spec, repoPathResolver(ctx.root, ctx.at, ctx.cwd)) : undefined;
  const view = drift && { drift, now: ctx.now };
  const ghosts = drift && ctx.plan?.diagram === 'flow' ? ghostsFor(drift, new Set(spec.steps.map((s) => s.id)), ctx.plan.spec.links) : undefined;
  const tree = { maxNodes: ctx.maxNodes, width: ctx.width, color: ctx.color, md: ctx.md, check, drift: view };
  const snapshot = () => flowSnapshot(spec, snippets, rangeOf(ctx.root, ctx.selection), drift?.items, ghosts?.links);
  const chosen = await chooseOutput(
    ctx.output,
    // Now and After side by side exist only in the HTML.
    spec.steps.length >= ctx.minNodes || hasFlowNowAfter(spec),
    (htmlPath) => renderFlowTree(spec, { ...tree, htmlPath }),
    () => ctx.write(async (meta) => renderFlowHtml(spec, await layoutFlow(withGhosts(spec, ghosts)), snippets, meta, check, ghosts), snapshot),
  );
  if (!chosen.html) ctx.saveReview(snapshot);
  if (chosen.kind === 'terminal') return { text: chosen.text, check, html: chosen.html, drift };
  const alert = [webAlert(check, ctx.width), driftBlock(view, { ...ctx, htmlPath: chosen.html.file })].filter(Boolean).join('\n\n');
  const text = ctx.md
    ? flowMarkdown(spec.title, alert || undefined, { width: ctx.width, htmlPath: chosen.html.file }, flowKey(spec))
    : `${alert ? `${alert}\n` : ''}${fullMapLine(chosen.html.file)}\n`;
  return { text, check, html: chosen.html, drift };
}
