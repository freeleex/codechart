import type { ReleaseSpec } from '../../spec/release.js';
import { dataCard, journeyCard, questionCard, ruleCard } from '../business/html.js';
import { LEGEND, pageShell, updateNote } from '../business/shell.js';
import { esc, MONTHS, type HtmlMeta } from '../web/page.js';
import { RELEASE_CSS } from './styles.js';

type Section = ReleaseSpec['sections'][number];
type Change = Section['change'];

/** What the page shows beside the spec: the product name (default: the repo name) and the logo as a `data:` URI. */
export interface Brand {
  product?: string;
  logo?: string;
}

const CHANGES: Change[] = ['new', 'changed', 'fixed'];
const LABEL: Record<Change, string> = { new: 'New', changed: 'Changed', fixed: 'Fixed' };

/** "8 Nov 2026" for a YYYY-MM-DD date. */
const day = (d: string): string => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

const countOf = (spec: ReleaseSpec, c: Change): number => spec.sections.filter((s) => s.change === c).length;

const versionLine = (spec: ReleaseSpec): string => `Version ${esc(spec.version)}${spec.since ? ` (since ${esc(spec.since)})` : ''}`;

const group = (name: string, title: string, body: string): string => (body ? `<div class="f-grp" data-group="${name}"><p class="f-sub">${title}</p>${body}</div>` : '');

const cards = <T>(items: T[], card: (x: T) => string, wrap = ''): string => (items.length ? `${wrap ? `<div class="${wrap}">` : ''}${items.map(card).join('\n')}${wrap ? '</div>' : ''}` : '');

function section(s: Section): string {
  const about = [...s.journeys, ...s.rules, ...s.data];
  const pr = s.pr === undefined ? '' : `<span class="pr">PR #${s.pr}</span>`;
  return `<section class="feature" id="s-${esc(s.id)}" data-section="${esc(s.id)}">
<div class="f-head"><span class="chg-badge chg-${s.change}">${LABEL[s.change]}</span><h2>${esc(s.title)}</h2>${pr}</div>
<p class="f-sum">${esc(s.summary)}</p>
${group('journeys', 'How it works', cards(s.journeys, journeyCard))}
${group('rules', 'Rules', cards(s.rules, ruleCard, 'rules'))}
${group('data', 'Information kept', cards(s.data, dataCard, 'data'))}
${group('questions', 'Questions for you', cards(s.questions, (q) => questionCard(about, q, s.questions.indexOf(q)), 'qs'))}
</section>`;
}

const countText = (spec: ReleaseSpec): string =>
  CHANGES.flatMap((c) => (countOf(spec, c) ? [`${countOf(spec, c)} ${c}`] : [])).join(' · ');

/** The release map as one self-contained page: a header, one section per feature, and the buttons to send notes back and export. */
export function releasePage(spec: ReleaseSpec, meta: HtmlMeta, brand: Brand = {}): string {
  const product = esc(brand.product ?? meta.repo);
  const logo = brand.logo ? `<img src="${esc(brand.logo)}" alt="">` : '';
  const pills = CHANGES.map((c) => `<span class="pill"><b>${countOf(spec, c)}</b> ${c}</span>`).join('');
  const header = `<div class="wrap">
<div class="eyebrow"><span class="brand"><i></i>codechart · release map</span><span class="rel-id">${logo}${product}</span><span>${versionLine(spec)}</span><time datetime="${esc(spec.date)}">${day(spec.date)}</time>${updateNote(meta)}</div>
<h1>${esc(spec.title)}</h1>
<p class="summary">${esc(spec.summary)}</p>
<div class="stats">${pills}</div>
${LEGEND}
</div>`;
  const cover = `<div class="cover">${logo}<div class="co-product">${product}</div><h1>${esc(spec.title)}</h1><div class="co-meta">${versionLine(spec)} · ${day(spec.date)}</div><p class="summary">${esc(spec.summary)}</p><div class="co-counts">${esc(countText(spec))}</div></div>`;
  const main = `${cover}
${spec.sections.map(section).join('\n')}
<footer>Made by codechart from the developer's changes. Items marked "Checked in code" were read in the code; the others are the agent's reading.</footer>`;
  const bar = `<div class="bar"><div class="wrap"><span class="count"><b id="note-count">0</b> <span id="note-label">answers and notes</span> so far</span><span class="acts"><button type="button" class="exp" id="export" disabled>Export release</button><button type="button" class="send" id="send" disabled>Send back to developer</button></span></div></div>`;
  return pageShell({ page: 'release', title: spec.title, css: RELEASE_CSS, meta, header, main, bar });
}
