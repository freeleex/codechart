// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { releasePage } from '../../src/render/release/html.js';
import { validateReleaseSpec } from '../../src/spec/release.js';
import { release } from '../fixtures/release.js';
import { click, mount, q, qa, usePages } from '../helpers/page.js';

usePages();

const change = { slug: 'what-is-new-in-shop-2-0.business', branch: 'main', at: '2026-11-09T12:00:00.000Z' };
const meta = { generatedAt: new Date('2026-11-09T12:00:00Z'), repo: 'shop', change };
const build = (brand = {}, spec = release()) => {
  const parsed = validateReleaseSpec(spec);
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  return releasePage(parsed.spec, meta, brand);
};
const html = build();

const verdict = (id: string, v: 'yes' | 'no') => click(q(`[data-item="${id}"] [data-verdict="${v}"]`));
const exportBtn = () => q<HTMLButtonElement>('#export');
const print = vi.fn();

afterEach(() => print.mockReset());

function open(page = html): void {
  mount(page);
  window.print = print;
}

describe('release page', () => {
  it('shows the product, version, date, summary and the counts', () => {
    mount(html);
    expect(q('h1').textContent).toBe('What is new in Shop 2.0');
    expect(q('.eyebrow').textContent).toContain('shop');
    expect(q('.eyebrow').textContent).toContain('Version 2.0.0 (since 1.4.0)');
    expect(q('.eyebrow time').textContent).toBe('9 Nov 2026');
    expect(q('header .summary').textContent).toContain('money back faster');
    expect(qa('.stats .pill').map((p) => p.textContent)).toEqual(['1 new', '1 changed', '1 fixed']);
  });

  it('uses the configured product name and the logo, on the cover too', () => {
    mount(build({ product: 'Acme Shop', logo: 'data:image/png;base64,AAAA' }));
    expect(q('.rel-id').textContent).toBe('Acme Shop');
    expect(q('.cover .co-product').textContent).toBe('Acme Shop');
    expect(qa('img').map((i) => i.getAttribute('src'))).toEqual(['data:image/png;base64,AAAA', 'data:image/png;base64,AAAA']);
  });

  it('has one section per feature with its badge, PR and items', () => {
    mount(html);
    const sections = qa('section.feature');
    expect(sections.map((s) => s.querySelector('h2')!.textContent)).toEqual(['Faster refunds', 'Shorter refund window', 'Receipts open again']);
    expect(sections.map((s) => s.querySelector('.chg-badge')!.textContent)).toEqual(['New', 'Changed', 'Fixed']);
    expect(sections[0]!.querySelector('.pr')!.textContent).toBe('PR #41');
    expect(sections[1]!.querySelector('.pr')).toBeNull();
    expect(qa('[data-item]').map((c) => c.getAttribute('data-item'))).toEqual(['J1', 'J2', 'R1', 'Q1', 'R2', 'D1']);
    expect(sections[0]!.querySelectorAll('[data-item]')).toHaveLength(4);
    expect(sections[2]!.querySelector('[data-item]')).toBeNull();
    expect(q('[data-item="Q1"] a[data-jump]').textContent).toBe('Manager approval');
  });

  it('shows no tech map links, ids or section ids as text', () => {
    mount(html);
    expect(q('main').textContent).not.toMatch(/\b(J1|J2|R1|R2|D1|Q1)\b/);
  });

  it('keeps the trust tags, Yes/No and notes of the business page', () => {
    mount(html);
    expect(qa('[data-item] .ev.ok')).toHaveLength(2);
    expect(qa('.card.guess')).toHaveLength(3);
    expect(qa('.confirm')).toHaveLength(3);
    expect(qa('[data-cbtn]')).toHaveLength(5);
    expect(q<HTMLButtonElement>('#send').disabled).toBe(true);
  });

  it('keeps Export disabled until every reading has a Yes or No, and says how many are left', () => {
    open();
    expect(exportBtn().disabled).toBe(true);
    expect(exportBtn().textContent).toBe('Confirm 3 items to export');
    expect(exportBtn().title).toContain('3 items');
    verdict('J2', 'yes');
    expect(exportBtn().textContent).toBe('Confirm 2 items to export');
    verdict('R1', 'no');
    expect(exportBtn().textContent).toBe('Confirm 1 item to export');
    click(exportBtn());
    expect(print).not.toHaveBeenCalled();
    expect(document.body.classList.contains('exporting')).toBe(false);
    verdict('D1', 'yes');
    expect(exportBtn().disabled).toBe(false);
    expect(exportBtn().textContent).toBe('Export release');
  });

  it('takes a Yes or No back: Export locks again', () => {
    open();
    for (const id of ['J2', 'R1', 'D1']) verdict(id, 'yes');
    expect(exportBtn().disabled).toBe(false);
    verdict('D1', 'yes');
    expect(exportBtn().textContent).toBe('Confirm 1 item to export');
  });

  it('exports: the body gets the class, rejected items and emptied groups are marked, print is called, afterprint undoes it', () => {
    open();
    verdict('J2', 'yes');
    verdict('R1', 'no');
    verdict('D1', 'no');
    click(exportBtn());
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains('exporting')).toBe(true);
    expect(qa('.rejected').map((e) => e.getAttribute('data-item') ?? `group:${e.getAttribute('data-group')}`)).toEqual(['group:rules', 'R1', 'group:data', 'D1']);
    expect(q('[data-item="J2"]').classList.contains('rejected')).toBe(false);
    expect(q('[data-group="journeys"]').classList.contains('rejected')).toBe(false);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.body.classList.contains('exporting')).toBe(false);
    expect(qa('.rejected')).toHaveLength(0);
  });

  it('a page without the export button (the business page) starts fine', async () => {
    const { businessPage } = await import('../../src/render/business/html.js');
    const { validateBusinessSpec } = await import('../../src/spec/business.js');
    const { business } = await import('../fixtures/business.js');
    const b = validateBusinessSpec(business());
    if (!b.ok) throw new Error('fixture');
    mount(businessPage(b.spec, meta));
    expect(document.getElementById('export')).toBeNull();
    expect(q('#note-count').textContent).toBe('0');
  });
});

describe('release page styles', () => {
  const css = (): string => q<HTMLStyleElement>('style').textContent!;

  it('hides the review parts and the rejected items in the printed view, light colours whatever the theme', () => {
    mount(html);
    const text = css();
    const printed = text.slice(text.indexOf('@media print'));
    for (const hidden of ['.cbox', '.cview', '.cacts', '.confirm', '.ev', '.legend', '.bar', '.modal', '[data-group="questions"]', '.rejected']) expect(printed).toContain(`body.exporting ${hidden}`.replace('body.exporting ', ''));
    expect(printed).toMatch(/body\.exporting [^{]*\.rejected[^{]*\{display:none!important\}/);
    expect(printed).toContain(':root:root:root{color-scheme:light;--bg:#f6f8fa');
    expect(printed).toContain('.cover{display:block;break-after:page');
    expect(printed).not.toContain('section.feature{break-before:page');
    expect(text).toContain('@bottom-right{content:counter(page)');
  });

  it('shows the cover only when exporting', () => {
    mount(html);
    expect(css()).toMatch(/\.cover\{display:none\}/);
    expect(css()).toMatch(/body\.exporting \.cover\{display:block/);
  });
});
