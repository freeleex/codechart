import { businessPage } from './html.js';
import { businessSnapshot } from '../../review/snapshot.js';
import { isExplain, itemGroups, questionsOf, type BusinessSpec } from '../../spec/business.js';
import type { TechBox } from '../../spec/business-links.js';
import { markdownBlock } from '../markdown.js';
import { fullMapLine } from '../terminal/render.js';
import type { WrittenHtml, WriteHtml } from '../web/write.js';

export interface BusinessContext {
  md: boolean;
  /** The boxes of the tech map the spec's links were checked against. */
  tech: TechBox[];
  /** Writes the page and, for a change map, its review file (`businessSnapshot`) as the other maps do. An explain page is read-only: nothing comes back, so it has none. */
  write: WriteHtml;
}

const count = (n: number, one: string, many = `${one}s`): string | undefined => (n ? `${n} ${n === 1 ? one : many}` : undefined);

function businessSummary(spec: BusinessSpec): string {
  const groups = itemGroups(spec);
  const items = groups.flatMap(([, list]) => list);
  const parts = [
    isExplain(spec) ? count(spec.flow.steps.length, 'step') : count(spec.journeys.length, 'journey'),
    count(spec.rules.length, 'rule'),
    count(groups.find(([g]) => g === 'cases')?.[1].length ?? 0, 'odd case'),
    count(spec.data.length, 'saved data', 'saved data'),
    count(questionsOf(spec).length, 'question'),
    count(items.filter((x) => x.evidence === 'reading').length, "agent's reading"),
  ];
  return [`${isExplain(spec) ? 'Business explain page' : 'Business map'}: ${spec.title}`, ...parts.filter(Boolean)].join(' · ');
}

/** Business maps are HTML-only: the page is always written, and the console gets one summary line with its link. */
export async function renderBusiness(spec: BusinessSpec, ctx: BusinessContext): Promise<{ text: string; html: WrittenHtml }> {
  const html = await ctx.write(async (meta) => businessPage(spec, meta), isExplain(spec) ? undefined : () => businessSnapshot(spec));
  const summary = businessSummary(spec);
  if (ctx.md) return { text: markdownBlock('**Business map**', summary, html.file), html };
  return { text: `${summary}\n${fullMapLine(html.file)}\n`, html };
}
