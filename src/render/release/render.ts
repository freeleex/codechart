import { releaseSnapshot } from '../../review/snapshot.js';
import type { ReleaseSpec } from '../../spec/release.js';
import { markdownBlock } from '../markdown.js';
import { fullMapLine } from '../terminal/render.js';
import type { WrittenHtml, WriteHtml } from '../web/write.js';
import { releasePage, type Brand } from './html.js';

export interface ReleaseContext {
  md: boolean;
  brand: Brand;
  /** Writes the page and its review file (`releaseSnapshot`) as the other maps do. */
  write: WriteHtml;
}

const count = (n: number, one: string, many = `${one}s`): string | undefined => (n ? `${n} ${n === 1 ? one : many}` : undefined);

function releaseSummary(spec: ReleaseSpec): string {
  const items = spec.sections.flatMap((s) => [...s.journeys, ...s.rules, ...s.data]);
  const parts = [
    count(spec.sections.length, 'feature'),
    ...(['new', 'changed', 'fixed'] as const).map((c) => count(spec.sections.filter((s) => s.change === c).length, c, c)),
    count(items.filter((x) => x.evidence === 'reading').length, "agent's reading"),
  ];
  return [`Release map: ${spec.title} (${spec.version})`, ...parts.filter(Boolean)].join(' · ');
}

/** Release maps are HTML-only: the page is always written, and the console gets one summary line with its link. */
export async function renderRelease(spec: ReleaseSpec, ctx: ReleaseContext): Promise<{ text: string; html: WrittenHtml }> {
  const html = await ctx.write(async (meta) => releasePage(spec, meta, ctx.brand), () => releaseSnapshot(spec));
  const summary = releaseSummary(spec);
  if (ctx.md) return { text: markdownBlock(`**${summary}**`, undefined, html.file), html };
  return { text: `${summary}\n${fullMapLine(html.file)}\n`, html };
}
