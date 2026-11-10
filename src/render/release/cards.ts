import type { ReleaseSpec } from '../../spec/release.js';
import { esc } from '../web/page.js';

type Section = ReleaseSpec['sections'][number];
type Journey = Section['journeys'][number];
type Rule = Section['rules'][number];
type Datum = Section['data'][number];
type Step = Journey['now'][number];

const MARK = { new: ['add', 'New'], changed: ['chg', 'Changed'], removed: ['rem', 'Removed'] } as const;

function step(s: Step): string {
  const [cls, label] = s.change ? MARK[s.change] : ['same', ''];
  return `<li class="step ${cls}">${label ? `<span class="mk ${cls}">${label}</span> ` : ''}<span class="t">${esc(s.text)}</span></li>`;
}

const steps = (list: Step[]): string => (list.length ? `<ol class="steps">${list.map(step).join('')}</ol>` : '<p class="none">Nothing happens here.</p>');

export function journeyCard(j: Journey): string {
  const who = j.who ? `<span class="who">${esc(j.who)}</span>` : '';
  return `<article class="card journey"><div class="j-head"><h3>${esc(j.name)}</h3>${who}</div>
<div class="j-cols"><div class="j-col"><h4>Now</h4>${steps(j.now)}</div><div class="j-col"><h4>After this change</h4>${steps(j.after)}</div></div></article>`;
}

export function ruleCard(r: Rule): string {
  const before = r.before === undefined ? '' : `<dt>Before</dt><dd class="was">${esc(r.before)}</dd>`;
  const exceptions = r.exceptions?.length ? `<div class="exc"><b>Except:</b><ul>${r.exceptions.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  return `<article class="card rule"><span class="mk ${r.before === undefined ? 'add' : 'chg'}">${r.before === undefined ? 'New rule' : 'Changed rule'}</span>
<h3>${esc(r.name)}</h3><dl class="ba">${before}<dt>After</dt><dd>${esc(r.after)}</dd></dl>${exceptions}</article>`;
}

export function dataCard(d: Datum): string {
  return `<article class="card datum"><span class="mk add">Kept</span><h3>${esc(d.name)}</h3><p>${esc(d.what)}</p><p class="why">${esc(d.why)}</p></article>`;
}
