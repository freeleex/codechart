// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { layoutSpec, PANE_CANVASES } from '../../src/render/web/layout.js';
import { renderHtml } from '../../src/render/web/html.js';
import { renderFlowHtml } from '../../src/render/flow/html.js';
import { layoutFlow } from '../../src/render/flow/layout.js';
import { validateSpec, type Spec } from '../../src/spec/schema.js';
import { sampleFlow, sampleSnippets } from './flow-fixture.js';

function mapSpec(raw: unknown): Spec {
  const r = validateSpec(raw);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  if (r.spec.diagram === 'flow') throw new Error('expected map spec');
  return r.spec;
}

const meta = { generatedAt: new Date('2026-11-05T12:00:00Z'), repo: 'demo' };
const shop = mapSpec(JSON.parse(readFileSync('tests/fixtures/shop.spec.json', 'utf8')));
const page = renderHtml(shop, await layoutSpec(shop), meta);
const plan = mapSpec({
  title: 'Users join teams',
  kind: 'plan',
  nodes: [
    { id: 'users', label: 'users', kind: 'table', status: 'changed', layer: 'database' },
    { id: 'teams', label: 'teams', kind: 'table', status: 'new', layer: 'database' },
    { id: 'api', label: 'GET /users', kind: 'endpoint', status: 'changed', layer: 'backend' },
  ],
  edges: [{ from: 'api', to: 'users', label: 'reads', kind: 'reads' }],
});
const panesPage = renderHtml(plan, await layoutSpec(plan, PANE_CANVASES), meta);
const flow = sampleFlow();
const flowPage = renderFlowHtml(flow, await layoutFlow(flow), sampleSnippets(), meta);

const q = <T extends Element>(sel: string) => document.querySelector(sel) as T;
const panel = () => q<HTMLElement>('#panel');
const back = () => q<HTMLButtonElement>('#nav-back');
const forward = () => q<HTMLButtonElement>('#nav-forward');
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const open = (id: string) => click(q(`.node[data-id="${id}"]`));
const shown = () => (panel().hidden ? 'info' : [...document.querySelectorAll('.node.selected')].map((g) => g.getAttribute('data-id'))[0]);
const alt = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true }));

// Each mount runs the page script again; drop the window listeners of the last one.
const added: [string, EventListenerOrEventListenerObject][] = [];
const addListener = window.addEventListener.bind(window);

function mount(html: string, hash = ''): void {
  history.replaceState(null, '', `/${hash}`);
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
  for (const s of document.querySelectorAll('script')) if (s.type !== 'application/json') new Function(s.textContent ?? '')();
}

beforeEach(() => {
  if (!('escape' in CSS)) {
    (CSS as { escape?: (s: string) => string }).escape = (s) => s.replace(/([^\w-])/g, '\\$1');
  }
  window.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: AddEventListenerOptions) => {
    added.push([type, fn]);
    addListener(type, fn, opts);
  }) as typeof window.addEventListener;
});

afterEach(() => {
  for (const [type, fn] of added.splice(0)) window.removeEventListener(type, fn);
  window.addEventListener = addListener;
});

describe('panel history', () => {
  it('starts on page-info with nothing to go back or forward to', () => {
    mount(page);
    expect(shown()).toBe('info');
    expect(back().disabled).toBe(true);
    expect(forward().disabled).toBe(true);
  });

  it('Back returns to the node you came from; Forward goes to it again', () => {
    mount(page);
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
    mount(page);
    open('tbl.orders');
    click(q('#info-toggle'));
    expect(shown()).toBe('info');
    expect(location.hash).toBe('#info');
    click(back());
    expect(shown()).toBe('tbl.orders');
  });

  it('a new visit after Back drops Forward; reopening the shown node adds nothing', () => {
    mount(page);
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
    mount(page);
    open('tbl.orders');
    open('tbl.invoices');
    alt('ArrowLeft');
    expect(shown()).toBe('tbl.orders');
    alt('ArrowRight');
    expect(shown()).toBe('tbl.invoices');
  });

  it("the browser's own Back walks the same history", () => {
    mount(page);
    open('tbl.orders');
    open('tbl.invoices');
    history.back();
    expect(shown()).toBe('tbl.orders');
    expect(forward().disabled).toBe(false);
  });

  it('a URL naming a node opens it; an unknown one opens page-info', () => {
    mount(page, '#node=tbl.orders');
    expect(shown()).toBe('tbl.orders');
    mount(page, '#node=nope');
    expect(shown()).toBe('info');
  });

  it('Back pans to the node when it is off screen', () => {
    mount(page);
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
    mount(page);
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
