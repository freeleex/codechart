import type { ReleaseSpec } from '../../spec/release.js';
import type { WrittenHtml, WriteHtml } from '../web/write.js';
import { releasePage, type Brand } from './html.js';

export interface ReleaseContext {
  brand: Brand;
  write: WriteHtml;
}

const count = (n: number, one: string, many = `${one}s`): string | undefined => (n ? `${n} ${n === 1 ? one : many}` : undefined);

/** "Release map: <title> (<version>) · 3 features · 1 new · …" */
export function releaseSummary(spec: ReleaseSpec): string {
  const parts = [count(spec.sections.length, 'feature'), ...(['new', 'changed', 'fixed'] as const).map((c) => count(spec.sections.filter((s) => s.change === c).length, c, c))];
  return [`Release map: ${spec.title} (${spec.version})`, ...parts.filter(Boolean)].join(' · ');
}

/** Writes the page; it has no review file, nothing is sent back. */
export const renderRelease = (spec: ReleaseSpec, ctx: ReleaseContext): Promise<WrittenHtml> => ctx.write(async (meta) => releasePage(spec, meta, ctx.brand));
