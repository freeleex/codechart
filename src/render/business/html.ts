import { THEMES, type Theme } from '../../config/schema.js';
import type { BusinessSpec } from '../../spec/business.js';
import { CLIENT_JS } from '../web/client.js';
import { esc, jsonForScript, PAGE_CSP, prettyDate, type HtmlMeta } from '../web/page.js';
import { BUSINESS_CSS } from './styles.js';

type Spec = BusinessSpec;
type Journey = Spec['journeys'][number];
type Rule = Spec['rules'][number];
type Datum = Spec['data'][number];
type Step = Journey['now'][number];
type Evidence = Journey['evidence'];

type Kind = 'journey' | 'rule' | 'data' | 'question';
const MARK = { new: ['add', 'New'], changed: ['chg', 'Changed'], removed: ['rem', 'Removed'] } as const;

const plural = (n: number, one: string, many = `${one}s`): string => `<b>${n}</b> ${n === 1 ? one : many}`;

const tag = (e: Evidence): string => (e === 'checked' ? '<span class="ev ok">Checked in code</span>' : '<span class="ev guess">Agent\'s reading — please confirm</span>');

const attrs = (kind: Kind, id: string, name: string): string => `id="i-${esc(id)}" data-item="${esc(id)}" data-kind="${kind}" data-name="${esc(name)}"`;

const noteButton = (id: string): string => `<button type="button" class="cbtn" data-cbtn="${esc(id)}" aria-expanded="false"><span>Add a note</span></button>`;

const noteBox = (id: string, cls = ''): string =>
  `<div class="cbox${cls}" data-cbox="${esc(id)}"><textarea data-note="${esc(id)}" maxlength="4000" aria-label="Your note" placeholder="Your note to the developer…"></textarea></div>`;

const confirm = (): string =>
  '<span class="confirm" role="group" aria-label="Is the agent\'s reading right?"><button type="button" class="yes" data-verdict="yes" aria-pressed="false">Yes, that\'s right</button><button type="button" class="no" data-verdict="no" aria-pressed="false">No</button></span>';

function step(s: Step): string {
  const [cls, label] = s.change ? MARK[s.change] : ['same', ''];
  return `<li class="step ${cls}"><div class="box">${label ? `<span class="mk ${cls}">${label}</span>` : ''}<span class="t">${esc(s.text)}</span></div></li>`;
}

const steps = (list: Step[]): string => (list.length ? `<ol class="steps">${list.map(step).join('')}</ol>` : '<p class="none">Nothing happens here.</p>');

const initials = (who: string): string =>
  who
    .split(/\s+/)
    .map((w) => [...w][0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

function journeyCard(j: Journey): string {
  const who = j.who ? `<span class="actor"><span class="av">${esc(initials(j.who))}</span>${esc(j.who)}</span>` : '';
  return `<article class="card journey${j.evidence === 'reading' ? ' guess' : ''}" ${attrs('journey', j.id, j.name)}>
<div class="j-head"><h3>${esc(j.name)}</h3>${who}${tag(j.evidence)}</div>
<div class="j-cols"><div class="j-col now"><h4>Now</h4>${steps(j.now)}</div><div class="j-col after"><h4>After this change</h4>${steps(j.after)}</div></div>
${noteBox(j.id, ' j-cbox')}
<div class="j-foot">${j.evidence === 'reading' ? confirm() : '<span></span>'}${noteButton(j.id)}</div>
</article>`;
}

function ruleCard(r: Rule): string {
  const rows = `${r.before === undefined ? '' : `<dt>Before</dt><dd class="was">${esc(r.before)}</dd>`}<dt>After</dt><dd>${esc(r.after)}</dd>`;
  const exceptions = r.exceptions?.length ? `<div class="exc"><b>Except:</b><ul>${r.exceptions.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  return `<article class="card rule${r.evidence === 'reading' ? ' guess' : ''}" ${attrs('rule', r.id, r.name)}>
<div class="r-top">${r.before === undefined ? '<span class="mk add">New rule</span>' : '<span class="mk chg">Changed rule</span>'}${tag(r.evidence)}</div>
<h3>${esc(r.name)}</h3>
<dl class="ba">${rows}</dl>${exceptions}
${noteBox(r.id)}
<div class="r-foot">${r.evidence === 'reading' ? confirm() : '<span></span>'}${noteButton(r.id)}</div>
</article>`;
}

function dataCard(d: Datum): string {
  return `<article class="card datum${d.evidence === 'reading' ? ' guess' : ''}" ${attrs('data', d.id, d.name)}>
<div class="r-top"><span class="mk add">Kept</span>${tag(d.evidence)}</div>
<h3>${esc(d.name)}</h3><p>${esc(d.what)}</p><p class="why">${esc(d.why)}</p>
${noteBox(d.id)}
<div class="r-foot">${d.evidence === 'reading' ? confirm() : '<span></span>'}${noteButton(d.id)}</div>
</article>`;
}

function questionCard(spec: Spec, q: Spec['questions'][number], i: number): string {
  const about = [...spec.journeys, ...spec.rules, ...spec.data].find((x) => x.id === q.about)!;
  return `<article class="card qa" ${attrs('question', q.id, q.text)}><span class="qn">${i + 1}</span><div>
<p>${esc(q.text)}</p>
<div class="about">About: <a href="#i-${esc(q.about)}" data-jump>${esc(about.name)}</a></div>
<textarea data-answer="${esc(q.id)}" maxlength="4000" aria-label="Your answer" placeholder="Your answer…"></textarea></div></article>`;
}

function section(id: string, n: number, title: string, sub: string, body: string): string {
  return `<section id="${id}"><div class="sec-h"><span class="n">${n}</span><h2>${esc(title)}</h2></div><p class="sec-sub">${esc(sub)}</p>${body}</section>`;
}

function sections(spec: Spec): string[] {
  const out: [string, string, string, string][] = [];
  if (spec.journeys.length) out.push(['journeys', 'What people will experience', 'Each story shows how it works today and how it will work after this change.', spec.journeys.map(journeyCard).join('\n')]);
  if (spec.rules.length) out.push(['rules', 'Rules, before and after', "The business rules that apply after this change. Dashed amber cards are the agent's best reading and need your yes or no.", `<div class="rules">${spec.rules.map(ruleCard).join('\n')}</div>`]);
  if (spec.data.length) out.push(['data', 'What the business now keeps', 'Information saved because of this change, and why.', `<div class="data">${spec.data.map(dataCard).join('\n')}</div>`]);
  if (spec.questions.length) out.push(['questions', 'Questions for you', 'The developer could not decide these alone. Short answers are fine.', `<div class="qs">${spec.questions.map((q, i) => questionCard(spec, q, i)).join('\n')}</div>`]);
  return out.map(([id, title, sub, body], i) => section(id, i + 1, title, sub, body));
}

function stats(spec: Spec): string {
  const pill = (id: string, n: number, one: string, many?: string, cls = '') => (n ? `<a href="#${id}"${cls ? ` class="${cls}"` : ''}>${plural(n, one, many)}</a>` : '');
  return [pill('journeys', spec.journeys.length, 'journey'), pill('rules', spec.rules.length, 'rule'), pill('data', spec.data.length, 'saved item'), pill('questions', spec.questions.length, 'question for you ↓', 'questions for you ↓', 'q')].join('');
}

const LEGEND = `<div class="legend"><div class="grp"><span class="lab">How sure</span><span class="ev ok">Checked in code</span><span class="ev guess">Agent's reading — please confirm</span></div>
<div class="grp"><span class="lab">Steps</span><span class="mk add">New</span><span class="mk chg">Changed</span><span class="mk rem">Removed</span><span>plain = same as now</span></div></div>`;

const DIALOG = `<div class="modal" id="send-modal" role="dialog" aria-modal="true" aria-labelledby="send-title" hidden>
<div class="sheet"><h3 id="send-title">Your message for the developer</h3>
<p id="send-hint">Paste it into the chat or ticket where the developer works.</p>
<pre id="send-text"></pre>
<div class="row"><button type="button" id="send-copy">Copy again</button><button type="button" class="send" id="send-done">Done</button></div></div></div>`;

/** The business map as one self-contained page: plain words only, no code, files or ids on screen. */
export function businessPage(spec: BusinessSpec, meta: HtmlMeta): string {
  const theme: Theme = meta.theme && THEMES.includes(meta.theme) ? meta.theme : 'auto';
  const data = { page: 'business', repoKey: meta.repoKey ?? meta.repo, ...(meta.change && { change: meta.change }) };
  const update = meta.update ? `<span class="update">codechart ${esc(meta.update)} is out</span>` : '';
  return `<!doctype html>
<html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">
<title>${esc(spec.title)}</title>
<style>${BUSINESS_CSS}</style></head>
<body data-page="business">
<header><div class="wrap">
<div class="eyebrow"><span class="brand"><i></i>codechart · business view</span><time datetime="${meta.generatedAt.toISOString()}">${prettyDate(meta.generatedAt)}</time>${update}</div>
<h1>${esc(spec.title)}</h1>
<p class="summary">${esc(spec.summary)}</p>
<div class="stats">${stats(spec)}</div>
${LEGEND}
</div></header>
<main class="wrap">
${sections(spec).join('\n')}
<footer>Made by codechart from the developer's change. Items marked "Checked in code" were read in the code; the others are the agent's reading.</footer>
</main>
<div class="bar"><div class="wrap"><span class="count"><b id="note-count">0</b> <span id="note-label">answers and notes</span> so far</span><button type="button" class="send" id="send" disabled>Send back to developer</button></div></div>
${DIALOG}
<script type="application/json" id="spec-data">${jsonForScript(data)}</script>
<script>${CLIENT_JS}</script>
</body></html>
`;
}
