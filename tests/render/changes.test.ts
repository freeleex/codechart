// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseDiff, type Preview } from '../../src/render/preview.js';
import { changesHtml } from '../../src/render/web/changes.js';
import { click, flowPage, mount, node, panesPage, q, qa, shopPage, shopWith, usePages } from '../helpers/page.js';

usePages();

const hunk = (i: number, changed = 2) =>
  `@@ -${i * 20},3 +${i * 20},3 @@ fn${i}\n ctx\n${Array.from({ length: changed }, (_, j) => `-old${i}_${j}\n+new${i}_${j}`).join('\n')}\n`;
const diff = (hunks: number, changed = 1) => parseDiff('src/a.ts', Array.from({ length: hunks }, (_, i) => hunk(i + 1, changed)).join(''));

describe('changesHtml', () => {
  it('a small diff starts with every hunk open and no cut hint', () => {
    const html = changesHtml(diff(2));
    expect(html.match(/class="hunk"/g)).toHaveLength(2);
    expect(html).not.toContain('folded');
    expect(html).not.toContain('see all in Full');
    expect(html).toContain('<span class="lo">4 changed lines</span><span class="fo">4 changed lines</span>');
  });

  it('more than 80 changed lines or 6 hunks starts folded', () => {
    expect(changesHtml(diff(7)).match(/hunk folded/g)).toHaveLength(7);
    expect(changesHtml(diff(1, 41)).match(/hunk folded/g)).toHaveLength(1);
    expect(changesHtml(diff(6)).match(/hunk folded/g)).toBeNull();
    expect(changesHtml(diff(1, 40)).match(/hunk folded/g)).toBeNull();
  });

  it('Light keeps 3 hunks, Full the rest, and the hint counts what Light shows', () => {
    const html = changesHtml(diff(5));
    expect(html.match(/class="hunk( folded)?"/g)).toHaveLength(3);
    expect(html.match(/class="hunk( folded)? fo"/g)).toHaveLength(2);
    expect(html).toContain('showing 6 of 10 changed lines · see all in Full</button>');
    expect(html).toContain('data-mode-set="full"');
  });

  it('Light keeps 40 rows: later rows of the last hunk are Full only', () => {
    const html = changesHtml(parseDiff('a', `@@ -0,0 +1,100 @@\n${Array.from({ length: 100 }, (_, i) => `+l${i}`).join('\n')}`));
    expect(html.match(/class="d-add">\+l/g)).toHaveLength(39);
    expect(html.match(/class="d-add fo">\+l/g)).toHaveLength(61);
    expect(html).toContain('showing 39 of 100 changed lines');
  });

  it('a hunk folds to one line: counts, line, function, first change', () => {
    const html = changesHtml(diff(7));
    expect(html).toContain('<span class="hs-stat"><span class="d-add">+1</span> <span class="d-del">−1</span></span><span class="hs-ln">L20</span><span class="hs-fn">fn1</span><span class="hs-first">-old1_0</span>');
    expect(html).toContain('aria-expanded="false"');
  });

  it('Full says when it cut the file, and a note replaces the hunks', () => {
    const big: Preview = { ...diff(1), rows: 5000 };
    expect(changesHtml(big)).toContain(`<span class="fo">showing ${big.lines.length} of 5000 lines</span>`);
    expect(changesHtml({ path: 'package-lock.json', lines: [], total: 0, rows: 0, note: 'generated file, not shown' })).toBe(
      '<h3>Changes</h3><p class="more">generated file, not shown</p>',
    );
  });

  it('escapes the code and the function context', () => {
    const html = changesHtml(parseDiff('a', '@@ -1 +1 @@ <b>f</b>\n+<i>x</i>\n'));
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<i>');
  });
});

const withDiffs = (changed = 1, hunks = 8) =>
  shopWith(new Map([['tbl.orders', diff(hunks, changed)], ['tbl.invoices', diff(2)]]));
const mode = () => document.documentElement.getAttribute('data-mode');
const modeBtn = () => q<HTMLButtonElement>('#mode-toggle');
const key = (k: string, init: KeyboardEventInit = {}, target: EventTarget = window) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
const hunks = () => qa<HTMLElement>('#panel .hunk');
const current = () => qa('#panel .hunk.cur').map((h) => hunks().indexOf(h as HTMLElement));
const folded = () => hunks().map((h) => h.classList.contains('folded'));
const selected = () => q('.node.selected')?.getAttribute('data-id');

describe('Light / Full switch', () => {
  it('pages with diffs start Light with a header button; plan, flow and diff-less pages have none and are Full', () => {
    mount(withDiffs());
    expect(mode()).toBe('light');
    expect(modeBtn().textContent).toBe('Mode: Light');
    for (const page of [shopPage, panesPage, flowPage]) {
      mount(page);
      expect(mode()).toBe('full');
      expect(document.getElementById('mode-toggle')).toBeNull();
    }
  });

  it('the button toggles the mode and it is remembered', () => {
    mount(withDiffs());
    click(modeBtn());
    expect(mode()).toBe('full');
    expect(modeBtn().textContent).toBe('Mode: Full');
    mount(withDiffs(), false);
    expect(mode()).toBe('full');
    click(modeBtn());
    mount(withDiffs(), false);
    expect(mode()).toBe('light');
  });

  it('"see all in Full" in the panel switches to Full', () => {
    mount(withDiffs());
    click(node('tbl.orders'));
    click(q('#panel .see-full'));
    expect(mode()).toBe('full');
  });

  it('review ticks, the Reviewed box and the progress row are Full only', () => {
    mount(withDiffs());
    for (const sel of ['.tick', '#review']) expect(qa(sel).every((e) => e.classList.contains('fo'))).toBe(true);
    click(node('tbl.orders'));
    expect(q('#panel .tick-row').classList.contains('fo')).toBe(true);
  });
});

describe('hunk keys', () => {
  const full = () => {
    mount(withDiffs());
    click(modeBtn());
    click(node('tbl.orders'));
  };

  it('ignored in Light', () => {
    mount(withDiffs());
    click(node('tbl.orders'));
    key('n');
    key('r');
    expect(current()).toEqual([]);
    expect(qa('.node.reviewed')).toHaveLength(0);
  });

  it('n and p walk the hunks, opening and highlighting each; the end says what is next', () => {
    full();
    expect(folded().every(Boolean)).toBe(true);
    key('n');
    expect(current()).toEqual([0]);
    expect(folded()[0]).toBe(false);
    key('n');
    key('n');
    expect(current()).toEqual([2]);
    key('p');
    expect(current()).toEqual([1]);
    key('p');
    key('p');
    expect(current()).toEqual([0]);
    for (let i = 0; i < 8; i++) key('n');
    expect(current()).toEqual([7]);
    expect(q('#panel .hunk-end').textContent).toBe('end of node · ] next unreviewed');
    key('n');
    expect(qa('#panel .hunk-end')).toHaveLength(1);
    key('p');
    expect(qa('#panel .hunk-end')).toHaveLength(0);
    expect(current()).toEqual([7]);
  });

  it('n scrolls the hunk to the top of the panel', () => {
    full();
    const aside = q<HTMLElement>('aside');
    const top = (e: Element) => (e === aside ? 0 : 500);
    hunks()[0]!.getBoundingClientRect = () => ({ top: top(hunks()[0]!) }) as DOMRect;
    aside.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    aside.scrollTop = 0;
    key('n');
    expect(aside.scrollTop).toBe(500 - 100 - 6);
  });

  it('o folds the current hunk, O all or opens all', () => {
    full();
    key('n');
    key('o');
    expect(folded()[0]).toBe(true);
    key('o');
    expect(folded()[0]).toBe(false);
    key('O');
    expect(folded().every((f) => !f)).toBe(true);
    key('O');
    expect(folded().every(Boolean)).toBe(true);
  });

  it('clicking a hunk line folds it and makes it current', () => {
    full();
    click(q('#panel .hunk:nth-of-type(3) .hunk-sum'));
    expect(folded()[2]).toBe(false);
    expect(current()).toEqual([2]);
    key('n');
    expect(current()).toEqual([3]);
  });

  it('r toggles Reviewed like the box and the tick, with no advance', () => {
    full();
    key('r');
    expect(qa('.node.reviewed').map((g) => g.getAttribute('data-id'))).toEqual(['tbl.orders']);
    expect(q<HTMLInputElement>('#panel input[data-tick-for="tbl.orders"]').checked).toBe(true);
    expect(q('#review-count').textContent).toBe('1/12 reviewed');
    expect(selected()).toBe('tbl.orders');
    key('r');
    expect(qa('.node.reviewed')).toHaveLength(0);
  });

  it('] and [ select the next and previous unreviewed node and restart at hunk 1', () => {
    full();
    key('n');
    key('n');
    key(']');
    expect(selected()).not.toBe('tbl.orders');
    const there = selected();
    expect(current()).toEqual([]);
    key('[');
    expect(selected()).toBe('tbl.orders');
    expect(there).toBeDefined();
    click(q('#next-unreviewed'));
    expect(selected()).toBe(there);
  });

  it('? toggles the key help; Esc closes it', () => {
    full();
    const help = q<HTMLElement>('#key-help');
    expect(help.hidden).toBe(true);
    key('?', { shiftKey: true });
    expect(help.hidden).toBe(false);
    key('Escape');
    expect(help.hidden).toBe(true);
  });

  it('ignores keys with Ctrl, Meta or Alt held and while typing in a field; a focused checkbox still works', () => {
    full();
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) key('n', { [mod]: true });
    expect(current()).toEqual([]);
    const field = document.createElement('input');
    field.type = 'text';
    document.body.appendChild(field);
    key('n', {}, field);
    expect(current()).toEqual([]);
    const box = q<HTMLInputElement>('#panel input[data-tick-for]');
    key('n', {}, box);
    expect(current()).toEqual([0]);
  });

  it('on a node without hunks n shows the end note', () => {
    full();
    click(node('tbl.customers'));
    key('n');
    expect(qa('#panel .hunk-end')).toHaveLength(1);
  });

  it('the review, node and help keys work on a Now / After plan, which has no switch', () => {
    mount(panesPage);
    click(node('users'));
    key('r');
    expect(qa('.node.reviewed').map((g) => g.getAttribute('data-id'))).toEqual(['users', 'users']);
    key(']');
    expect(selected()).not.toBe('users');
    key('?', { shiftKey: true });
    expect(q<HTMLElement>('#key-help').hidden).toBe(false);
  });
});
