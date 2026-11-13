// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { click, flowPage, mount, panesPage, q, shopPage, usePages } from '../helpers/page.js';

usePages();

const panel = () => q<HTMLElement>('#panel');
const back = () => q<HTMLButtonElement>('#nav-back');
const forward = () => q<HTMLButtonElement>('#nav-forward');
const open = (id: string) => click(q(`.node[data-id="${id}"]`));
const shown = () => (panel().hidden ? 'info' : [...document.querySelectorAll('.node.selected')].map((g) => g.getAttribute('data-id'))[0]);
const alt = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true }));

describe('panel history', () => {
  it('starts on page-info with nothing to go back or forward to', () => {
    mount(shopPage);
    expect(shown()).toBe('info');
    expect(back().disabled).toBe(true);
    expect(forward().disabled).toBe(true);
  });

  it('Back returns to the node you came from; Forward goes to it again', () => {
    mount(shopPage);
    open('tbl.orders');
    open('tbl.invoices');
    expect(location.hash).toBe('#node=tbl.invoices');
    click(back());
    expect(shown()).toBe('tbl.orders');
    expect(panel().querySelector('h2')?.textContent).toContain('orders');
    expect(forward().disabled).toBe(false);
    click(forward());
    expect(shown()).toBe('tbl.invoices');
    expect(forward().disabled).toBe(true);
    click(back());
    click(back());
    expect(shown()).toBe('info');
    expect(back().disabled).toBe(true);
  });

  it('opening Check / gaps is a visit: Back reopens the node', () => {
    mount(shopPage);
    open('tbl.orders');
    click(q('#info-toggle'));
    expect(shown()).toBe('info');
    expect(location.hash).toBe('#info');
    click(back());
    expect(shown()).toBe('tbl.orders');
  });

  it('a new visit after Back drops Forward; reopening the shown node adds nothing', () => {
    mount(shopPage);
    open('tbl.orders');
    open('tbl.invoices');
    click(back());
    open('tbl.customers');
    expect(forward().disabled).toBe(true);
    open('tbl.customers');
    click(back());
    expect(shown()).toBe('tbl.orders');
  });

  it('Alt+← and Alt+→ walk the history', () => {
    mount(shopPage);
    open('tbl.orders');
    open('tbl.invoices');
    alt('ArrowLeft');
    expect(shown()).toBe('tbl.orders');
    alt('ArrowRight');
    expect(shown()).toBe('tbl.invoices');
  });

  it('Alt+← with nothing to go back to is left to the browser', () => {
    mount(shopPage);
    const e = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    open('tbl.orders');
    const e2 = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, cancelable: true });
    window.dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(true);
  });

  it('after a reload Back and Forward still reach the visits around this one', () => {
    mount(shopPage);
    open('tbl.orders');
    open('tbl.invoices');
    click(back());
    mount(shopPage, false, null);
    expect(shown()).toBe('tbl.orders');
    expect(back().disabled).toBe(false);
    expect(forward().disabled).toBe(false);
    click(forward());
    expect(shown()).toBe('tbl.invoices');
  });

  it('following a #node= link in the same tab opens that node and Back returns', () => {
    mount(shopPage);
    open('tbl.orders');
    history.pushState(null, '', '#node=tbl.invoices');
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    expect(shown()).toBe('tbl.invoices');
    click(back());
    expect(shown()).toBe('tbl.orders');
  });

  it("the browser's own Back walks the same history", () => {
    mount(shopPage);
    open('tbl.orders');
    open('tbl.invoices');
    history.back();
    expect(shown()).toBe('tbl.orders');
    expect(forward().disabled).toBe(false);
  });

  it('a URL naming a node opens it; an unknown one opens page-info', () => {
    mount(shopPage, true, '#node=tbl.orders');
    expect(shown()).toBe('tbl.orders');
    mount(shopPage, true, '#node=nope');
    expect(shown()).toBe('info');
  });

  it('Back pans to the node when it is off screen', () => {
    mount(shopPage);
    open('tbl.orders');
    open('tbl.invoices');
    const canvas = q<HTMLElement>('.canvas');
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    q<SVGGElement>('.node[data-id="tbl.orders"]').getBoundingClientRect = () => new DOMRect(900, 700, 100, 50);
    const at = () => q('.viewport').getAttribute('transform')!.match(/-?[\d.]+/g)!.slice(0, 2).map(Number);
    const [x, y] = at();
    click(back());
    expect(at()).toEqual([x! - 550, y! - 425]);
  });

  it('without browser history the buttons still work', () => {
    mount(shopPage);
    const push = history.pushState;
    history.pushState = () => {
      throw new Error('sandboxed');
    };
    try {
      open('tbl.orders');
      open('tbl.invoices');
      click(back());
      expect(shown()).toBe('tbl.orders');
      click(forward());
      expect(shown()).toBe('tbl.invoices');
    } finally {
      history.pushState = push;
    }
  });

  it('Now and After share one history', () => {
    mount(panesPage);
    const [now, after] = [...document.querySelectorAll('.canvas')];
    click(now!.querySelector('.node[data-id="users"]')!);
    click(after!.querySelector('.node[data-id="teams"]')!);
    click(after!.querySelector('.node[data-id="users"]')!);
    click(back());
    expect(shown()).toBe('teams');
    click(back());
    expect(shown()).toBe('users');
  });

  it('flows have the same history', () => {
    mount(flowPage);
    open('read');
    open('mode');
    click(back());
    expect(shown()).toBe('read');
  });
});
