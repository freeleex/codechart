import type { ReleaseSpec } from '../../spec/release.js';
import { esc, MONTHS, type HtmlMeta } from '../web/page.js';
import { dataCard, journeyCard, ruleCard } from './cards.js';
import { RELEASE_CSS } from './styles.js';

type Section = ReleaseSpec['sections'][number];
type Change = Section['change'];

/** What the page shows beside the spec: the product name (default: the repo name) and the logo as a `data:` URI. */
export interface Brand {
  product?: string;
  logo?: string;
}

// No script, so the page is only styles and images from `data:`.
const STATIC_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

const CHANGES: Change[] = ['new', 'changed', 'fixed'];
const LABEL: Record<Change, string> = { new: 'New', changed: 'Changed', fixed: 'Fixed' };

/** "8 Nov 2026" for a YYYY-MM-DD date. */
const day = (d: string): string => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

const countOf = (spec: ReleaseSpec, c: Change): number => spec.sections.filter((s) => s.change === c).length;

const group = (title: string, body: string): string => (body ? `<p class="f-sub">${title}</p>${body}` : '');

const cards = <T>(items: T[], card: (x: T) => string, wrap = ''): string => {
  const body = items.map(card).join('\n');
  return body && wrap ? `<div class="${wrap}">${body}</div>` : body;
};

const COMPACT_CARDS = 3;

function section(s: Section): string {
  const compact = s.journeys.length + s.rules.length + s.data.length <= COMPACT_CARDS;
  return `<section class="feature${compact ? ' compact' : ''}">
<div class="f-head"><span class="chg-badge chg-${s.change}">${LABEL[s.change]}</span><h2>${esc(s.title)}</h2></div>
<p class="f-sum">${esc(s.summary)}</p>
${group('How it works', cards(s.journeys, journeyCard))}
${group('Rules', cards(s.rules, ruleCard, 'rules'))}
${group('Information kept', cards(s.data, dataCard, 'data'))}
</section>`;
}

const versionLine = (spec: ReleaseSpec): string => `Version ${esc(spec.version)}${spec.since ? ` (since ${esc(spec.since)})` : ''} · ${day(spec.date)}`;

const countText = (spec: ReleaseSpec): string => CHANGES.flatMap((c) => (countOf(spec, c) ? [`${countOf(spec, c)} ${c}`] : [])).join(' · ');

/** The release map as one static document: a cover, then one section per feature. Looks the same on screen and on paper. */
export function releasePage(spec: ReleaseSpec, meta: HtmlMeta, brand: Brand = {}): string {
  const logo = brand.logo ? `<img src="${esc(brand.logo)}" alt="">` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${STATIC_CSP}">
<title>${esc(spec.title)}</title>
<style>${RELEASE_CSS}</style></head>
<body>
<main class="sheet">
<div class="cover">${logo}<div class="co-product">${esc(brand.product ?? meta.repo)}</div><h1>${esc(spec.title)}</h1><div class="co-meta">${versionLine(spec)}</div><p class="summary">${esc(spec.summary)}</p><div class="co-counts">${esc(countText(spec))}</div></div>
${spec.sections.map(section).join('\n')}
<footer>Made by codechart.</footer>
</main>
</body></html>
`;
}
