// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { Preview } from '../../src/render/preview.js';
import { click, flowPage, mount, node, panesPage, q, qa, shopPage, shopWith, usePages } from '../helpers/page.js';

usePages();

const diff = (text: string): Map<string, Preview> =>
  new Map([
    ['tbl.orders', { path: 'db/orders.sql', lines: [{ kind: 'add', n: 1, text }], shown: 1, total: 1 }],
    ['tbl.invoices', { path: 'db/invoices.sql', lines: [{ kind: 'add', n: 1, text: 'create table invoices' }], shown: 1, total: 1 }],
  ]);

const tick = (id: string, pane = 0) => node(id, pane).querySelector('.tick')!;
const reviewed = () => [...new Set(qa('.node.reviewed').map((g) => g.getAttribute('data-id')))].sort();
const count = () => q('#review-count').textContent;
const nextBtn = () => q<HTMLButtonElement>('#next-unreviewed');
const selected = () => q('.node.selected')?.getAttribute('data-id');
const box = (id: string) => q<HTMLInputElement>(`#panel input[data-tick-for="${id}"]`);

describe('reviewed ticks on the canvas', () => {
  it('every node, context included, has a tickbox, and its panel has one', () => {
    mount(shopPage);
    expect(qa('.node')).toHaveLength(12);
    expect(qa('.node .tick')).toHaveLength(12);
    click(node('tbl.customers'));
    expect(box('tbl.customers').checked).toBe(false);
  });

  it('a click ticks without selecting or opening the panel', () => {
    mount(shopPage);
    const hash = location.hash;
    click(tick('tbl.orders'));
    expect(reviewed()).toEqual(['tbl.orders']);
    expect(selected()).toBeUndefined();
    expect(q<HTMLElement>('#panel').hidden).toBe(true);
    expect(location.hash).toBe(hash);
    click(tick('tbl.orders'));
    expect(reviewed()).toEqual([]);
  });

  it('a press on the tick starts no pan', () => {
    mount(shopPage);
    const at = () => q('.viewport').getAttribute('transform');
    const before = at();
    tick('tbl.orders').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 90, clientY: 70 }));
    expect(at()).toBe(before);
    q('.canvas').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 90, clientY: 70 }));
    expect(at()).not.toBe(before);
  });

  it('visiting a node never ticks it', () => {
    mount(shopPage);
    click(node('tbl.orders'));
    click(node('tbl.invoices'));
    expect(reviewed()).toEqual([]);
    expect(count()).toBe('0/12 reviewed');
  });

  it('a ticked node keeps its opacity: the style changes the border only', () => {
    const rules = [...shopPage.matchAll(/[^{}\n]*\.reviewed[^{}]*\{[^}]*\}/g)].map((m) => m[0]);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.join('')).not.toMatch(/opacity/);
    expect(shopPage).toMatch(/\.node\.reviewed :is\(\.card,\.fold,\.shape\)\{stroke:var\(--muted\)\}/);
  });

  it('the panel tickbox and the canvas tick are one state', () => {
    mount(shopPage);
    click(node('tbl.orders'));
    box('tbl.orders').click();
    expect(reviewed()).toEqual(['tbl.orders']);
    click(node('tbl.invoices'));
    expect(box('tbl.invoices').checked).toBe(false);
    click(node('tbl.orders'));
    expect(box('tbl.orders').checked).toBe(true);
    click(tick('tbl.orders'));
    expect(box('tbl.orders').checked).toBe(false);
  });
});

describe('progress and next unreviewed', () => {
  it('counts every node', () => {
    mount(shopPage);
    click(tick('tbl.orders'));
    click(tick('tbl.customers'));
    expect(count()).toBe('2/12 reviewed');
  });

  it('fills a progress bar in step with the count', () => {
    mount(shopPage);
    const fill = () => q<HTMLElement>('#review-bar i').style.width;
    expect(fill()).toBe('0%');
    click(tick('tbl.orders'));
    click(tick('tbl.customers'));
    click(tick('tbl.invoices'));
    expect(fill()).toBe('25%');
  });

  it('selects the next unticked node after the selected one and wraps round', () => {
    mount(shopPage);
    const ids = qa('.node').map((g) => g.getAttribute('data-id')!);
    click(nextBtn());
    expect(selected()).toBe(ids[0]);
    click(tick(ids[1]!));
    click(nextBtn());
    expect(selected()).toBe(ids[2]);
    click(node(ids[11]!));
    click(nextBtn());
    expect(selected()).toBe(ids[0]);
    expect(location.hash).toBe(`#node=${ids[0]}`);
  });

  it('pans to the node when it is off screen', () => {
    mount(shopPage);
    const canvas = q<HTMLElement>('.canvas');
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    const first = qa<SVGGElement>('.node')[0]!;
    first.getBoundingClientRect = () => new DOMRect(900, 700, 100, 50);
    const before = q('.viewport').getAttribute('transform');
    click(nextBtn());
    expect(q('.viewport').getAttribute('transform')).not.toBe(before);
  });

  it('is disabled once everything is reviewed', () => {
    mount(shopPage);
    expect(nextBtn().disabled).toBe(false);
    for (const g of qa('.node')) click(g.querySelector('.tick')!);
    expect(count()).toBe('12/12 reviewed');
    expect(nextBtn().disabled).toBe(true);
  });
});

describe('remembering ticks', () => {
  it('a reload keeps them', () => {
    mount(shopPage);
    click(tick('tbl.orders'));
    click(tick('tbl.customers'));
    mount(shopPage, false);
    expect(reviewed()).toEqual(['tbl.customers', 'tbl.orders']);
    expect(count()).toBe('2/12 reviewed');
  });

  it('a re-render keeps a tick only where the node diff is the same; the old diff brings it back', () => {
    mount(shopWith(diff('alter table orders add coupon')));
    click(tick('tbl.orders'));
    click(tick('tbl.invoices'));
    click(tick('tbl.customers'));
    mount(shopWith(diff('alter table orders add coupon_code')), false);
    expect(reviewed()).toEqual(['tbl.customers', 'tbl.invoices']);
    mount(shopWith(diff('alter table orders add coupon')), false);
    expect(reviewed()).toEqual(['tbl.customers', 'tbl.invoices', 'tbl.orders']);
  });

  it('a node without a diff is keyed by its id alone', () => {
    mount(shopWith(diff('a')));
    click(tick('tbl.customers'));
    mount(shopPage, false);
    expect(reviewed()).toEqual(['tbl.customers']);
  });

  it('is kept per repo', () => {
    mount(shopWith(diff('a'), 'one'));
    click(tick('tbl.orders'));
    mount(shopWith(diff('a'), 'two'), false);
    expect(reviewed()).toEqual([]);
    mount(shopWith(diff('a'), 'one'), false);
    expect(reviewed()).toEqual(['tbl.orders']);
  });

  it("saving leaves another page's ticks of the repo alone", () => {
    localStorage.setItem('codechart.reviewed:demo', JSON.stringify([['elsewhere', '']]));
    mount(shopPage, false);
    click(tick('tbl.orders'));
    expect(JSON.parse(localStorage.getItem('codechart.reviewed:demo')!)).toEqual([
      ['elsewhere', ''],
      ['tbl.orders', ''],
    ]);
    click(tick('tbl.orders'));
    expect(JSON.parse(localStorage.getItem('codechart.reviewed:demo')!)).toEqual([['elsewhere', '']]);
  });

  it('ignores damaged storage', () => {
    for (const bad of ['{nope', '{"a":1}', '[["x",1],"y",null]']) {
      localStorage.setItem('codechart.reviewed:demo', bad);
      mount(shopPage, false);
      expect(reviewed()).toEqual([]);
    }
  });

  it('works while storage is blocked', () => {
    mount(shopPage);
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    try {
      click(tick('tbl.orders'));
      expect(reviewed()).toEqual(['tbl.orders']);
    } finally {
      Storage.prototype.getItem = get;
      Storage.prototype.setItem = set;
    }
  });
});

describe('Now / After and flows', () => {
  it('one tick per node id: ticking in one pane ticks the other', () => {
    mount(panesPage);
    expect(count()).toBe('0/6 reviewed');
    click(tick('users', 0));
    expect(node('users', 0).classList.contains('reviewed')).toBe(true);
    expect(node('users', 1).classList.contains('reviewed')).toBe(true);
    click(tick('teams', 1));
    click(tick('legacy', 0));
    expect(count()).toBe('3/6 reviewed');
    click(tick('users', 1));
    expect(reviewed()).toEqual(['legacy', 'teams']);
  });

  it('a tick does not select in either pane', () => {
    mount(panesPage);
    click(tick('users', 1));
    expect(selected()).toBeUndefined();
  });

  it('flow steps can be ticked, and the panel box works', () => {
    mount(flowPage);
    click(tick('mode'));
    expect(count()).toBe('1/5 reviewed');
    click(node('done'));
    box('done').click();
    expect(reviewed()).toEqual(['done', 'mode']);
    click(nextBtn());
    expect(selected()).toBe('read');
  });
});
