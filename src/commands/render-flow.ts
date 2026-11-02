import type { Output } from '../config/schema.js';
import type { FlowSnippets } from '../render/flow/anchors.js';
import { renderFlowHtml } from '../render/flow/html.js';
import { layoutFlow } from '../render/flow/layout.js';
import { flowMarkdown, renderFlowTree, type FlowTreeOptions } from '../render/flow/tree.js';
import { alertLine } from '../render/terminal/check-lines.js';
import { defaultWidth, fullMapLine } from '../render/terminal/render.js';
import type { HtmlMeta } from '../render/web/page.js';
import type { FlowSpec } from '../spec/flow.js';

interface FlowRenderContext {
  output: Exclude<Output, 'none'>;
  minNodes: number;
  tree: Omit<FlowTreeOptions, 'htmlPath'>;
  writeHtml: (build: (meta: HtmlMeta) => Promise<string>) => Promise<string>;
}

/** Writes the HTML when the output mode asks for it; returns what goes to stdout. */
export async function renderFlow(spec: FlowSpec, snippets: FlowSnippets, ctx: FlowRenderContext): Promise<string> {
  const { output } = ctx;
  const writeHtml = () => ctx.writeHtml(async (meta) => renderFlowHtml(spec, await layoutFlow(spec), snippets, meta, ctx.tree.check));

  let htmlPath: string | undefined;
  let tree: { text: string; truncated: boolean } | undefined;
  if (output === 'web' || output === 'both' || (output === 'auto' && spec.steps.length >= ctx.minNodes)) {
    htmlPath = await writeHtml();
  } else if (output === 'auto') {
    tree = renderFlowTree(spec, ctx.tree);
    if (tree.truncated) {
      htmlPath = await writeHtml();
      tree = undefined;
    }
  }

  if (output === 'web') {
    const width = ctx.tree.width ?? defaultWidth();
    const alert = alertLine(ctx.tree.check, width);
    if (ctx.tree.md) return flowMarkdown(spec.title, alert || undefined, htmlPath, width);
    return `${alert ? `${alert}\n` : ''}${fullMapLine(htmlPath!)}\n`;
  }
  return (tree ?? renderFlowTree(spec, { ...ctx.tree, htmlPath })).text;
}
