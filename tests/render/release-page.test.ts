// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { releasePage } from '../../src/render/release/html.js';
import { validateReleaseSpec } from '../../src/spec/release.js';
import { release } from '../fixtures/release.js';
import { mount, q, qa, usePages } from '../helpers/page.js';

usePages();

const meta = { generatedAt: new Date('2026-11-09T12:00:00Z'), repo: 'shop' };
const build = (brand = {}, spec = release()) => {
  const parsed = validateReleaseSpec(spec);
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  return releasePage(parsed.spec, meta, brand);
};
const html = build();
const within = (el: Element, sel: string): Element[] => [...el.querySelectorAll(sel)];

describe('release page', () => {
  it('has a cover with the product, title, version, date, summary and the counts', () => {
    mount(html);
    expect(q('.cover .co-product').textContent).toBe('shop');
    expect(q('.cover h1').textContent).toBe('What is new in Shop 2.0');
    expect(q('.cover .co-meta').textContent).toBe('Version 2.0.0 (since 1.4.0) · 9 Nov 2026');
    expect(q('.cover .summary').textContent).toContain('money back faster');
    expect(q('.cover .co-counts').textContent).toBe('1 new · 1 changed · 1 fixed');
  });

  it('puts the configured product name and logo on the cover', () => {
    mount(build({ product: 'Acme Shop', logo: 'data:image/png;base64,AAAA' }));
    expect(q('.co-product').textContent).toBe('Acme Shop');
    expect(qa('img').map((i) => i.getAttribute('src'))).toEqual(['data:image/png;base64,AAAA']);
  });

  it('leaves a zero count out of the cover', () => {
    const spec = release();
    spec.sections = spec.sections.slice(0, 1);
    mount(build({}, spec));
    expect(q('.co-counts').textContent).toBe('1 new');
  });

  it('has one section per feature with its badge, summary and items, and no PR number', () => {
    mount(html);
    const sections = qa('section.feature');
    expect(sections.map((s) => s.querySelector('h2')!.textContent)).toEqual(['Faster refunds', 'Shorter refund window', 'Receipts open again']);
    expect(sections.map((s) => s.querySelector('.chg-badge')!.textContent)).toEqual(['New', 'Changed', 'Fixed']);
    expect(sections.map((s) => within(s, '.card').length)).toEqual([3, 2, 0]);
    expect(q('main').textContent).not.toContain('PR #');
    expect(q('main').textContent).not.toMatch(/\b(J1|J2|R1|R2|D1)\b/);
  });

  it('shows journeys as now and after, a rule with its before and exception, and what is kept', () => {
    mount(html);
    const journey = q('.journey');
    expect(within(journey, 'h4').map((h) => h.textContent)).toEqual(['Before', 'Now']);
    expect(within(journey, '.j-col:first-child .step').map((t) => t.textContent)).toEqual(['Customer asks for money back', 'Agent passes it to a manager']);
    expect(within(journey, '.j-col:first-child .mk, .rem')).toHaveLength(0);
    expect(within(journey, '.j-col:last-child .mk').map((m) => m.textContent)).toEqual(['New']);
    expect(within(journey, '.step.add .t').map((t) => t.textContent)).toEqual(['Agent enters the amount and a reason']);
    const rules = qa('.rule');
    expect(rules.map((r) => r.querySelector('.mk')!.textContent)).toEqual(['New', 'Changed']);
    expect(within(rules[1]!, 'dt').map((d) => d.textContent)).toEqual(['Before', 'Now']);
    expect(q('main').textContent).not.toMatch(/Removed|After this change|New rule|Changed rule/);
    expect(rules[1]!.textContent).toContain('Up to 30 days after paying.');
    expect(rules[1]!.textContent).toContain('Annual plans keep 30 days.');
    expect(q('.datum').textContent).toContain('So finance can review refunds later');
  });

  it('is a static document: no script, no button, no trust tag, legend or dialog', () => {
    expect(html).not.toContain('<script');
    mount(html);
    expect(qa('script, button, textarea, input, dialog, .modal, .legend, .bar, .ev, .confirm, [data-item]')).toHaveLength(0);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it('escapes what the spec says', () => {
    const spec = release();
    spec.title = 'Shop <b>2.0</b>';
    expect(build({}, spec)).toContain('Shop &lt;b&gt;2.0&lt;/b&gt;');
  });
});

describe('release page styles', () => {
  const css = (): string => q<HTMLStyleElement>('style').textContent!;

  it('is light whatever the system theme', () => {
    mount(html);
    expect(css()).toContain('color-scheme:light');
    expect(css()).not.toMatch(/prefers-color-scheme|color-scheme:light dark|data-theme/);
  });

  it('prints A4 with page numbers on every page but the cover, and breaks pages only after the cover', () => {
    mount(html);
    expect(css()).toContain('@page{size:A4;');
    expect(css()).toContain('@bottom-right{content:counter(page)');
    expect(css()).toContain('@page:first{@bottom-right{content:none}}');
    expect(css()).toContain('.cover{padding-top:60mm;break-after:page}');
    expect(css()).not.toMatch(/\.feature\{[^}]*break-before/);
  });

  it('keeps a heading with its first content and a card in one piece', () => {
    mount(html);
    expect(css()).toContain('.f-head,.f-sum,.f-sub{break-after:avoid}');
    expect(css()).toContain('.f-head,.f-sum{break-inside:avoid}');
    expect(css()).toMatch(/\.card\{[^}]*break-inside:avoid/);
  });

  it('shows the same sheet on screen as on paper: only the screen adds a grey backdrop', () => {
    mount(html);
    expect(css()).toMatch(/@media screen\{[^]*\.sheet\{[^}]*max-width:210mm/);
    expect(css()).toContain('@media print{html,body{background:#fff}.compact{break-inside:avoid}}');
  });

  it('keeps a section of up to three cards together on paper and lets a bigger one flow', () => {
    const spec = release();
    spec.sections[0].rules.push({ id: 'R9', name: 'Extra', after: 'One more rule.' });
    mount(build({}, spec));
    expect(qa('section.feature').map((s) => s.classList.contains('compact'))).toEqual([false, true, true]);
  });
});
