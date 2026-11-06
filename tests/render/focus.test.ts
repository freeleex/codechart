// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { relationsHtml, relationsOf } from '../../src/render/web/tools.js';
import { CSS } from '../../src/render/web/styles.js';
import { click, flowPage, key, mount, node, panesPage, q, qa, shopPage, usePages } from '../helpers/page.js';

usePages();

const lit = (pane = 0) => qa<Element>('.canvas')[pane]!.querySelectorAll('.node.lit, .edge.lit');
const litIds = (pane = 0) => [...qa<Element>('.canvas')[pane]!.querySelectorAll('.node.lit')].map((g) => g.getAttribute('data-id')).sort();
const dimmed = () => document.body.classList.contains('focus');

describe('focus a node and its relations', () => {
  it('selecting a node lights it, its edges and its neighbours', () => {
    mount(shopPage);
    expect(dimmed()).toBe(false);
    click(node('tbl.invoices'));
    expect(dimmed()).toBe(true);
    const ids = litIds();
    expect(ids).toContain('tbl.invoices');
    const edges = qa<Element>('.edge.lit');
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) expect([e.getAttribute('data-from'), e.getAttribute('data-to')]).toContain('tbl.invoices');
    const near = new Set(edges.flatMap((e) => [e.getAttribute('data-from')!, e.getAttribute('data-to')!]));
    expect(new Set(ids)).toEqual(near);
    expect(qa('.node:not(.lit)').length).toBeGreaterThan(0);
  });

  it('Esc clears the focus and keeps the panel', () => {
    mount(shopPage);
    click(node('tbl.invoices'));
    key('Escape');
    expect(dimmed()).toBe(false);
    expect(lit()).toHaveLength(0);
    expect(q<HTMLElement>('#panel').hidden).toBe(false);
  });

  it('a click on the empty canvas clears it; a click on a node does not', () => {
    mount(shopPage);
    click(node('tbl.invoices'));
    click(q('.canvas'));
    expect(dimmed()).toBe(false);
    click(node('tbl.invoices'));
    expect(dimmed()).toBe(true);
    click(node('tbl.orders'));
    expect(dimmed()).toBe(true);
    expect(litIds()).toContain('tbl.orders');
  });

  it('selecting the shown node again lights it again after Esc', () => {
    mount(shopPage);
    click(node('tbl.invoices'));
    key('Escape');
    click(node('tbl.invoices'));
    expect(dimmed()).toBe(true);
  });

  it('page-info clears the focus', () => {
    mount(shopPage);
    click(node('tbl.invoices'));
    click(q('#info-toggle'));
    expect(dimmed()).toBe(false);
  });

  it('lights the same nodes in both panes', () => {
    mount(panesPage);
    click(node('users', 1));
    expect(litIds(1)).toEqual(['api', 'teams', 'users']);
    expect(litIds(0)).toEqual(['api', 'legacy', 'users']);
  });

  it('works on flows', () => {
    mount(flowPage);
    click(node('mode'));
    expect(litIds()).toEqual(['done', 'mode', 'print', 'read', 'web']);
    click(node('web'));
    expect(litIds()).toEqual(['done', 'mode', 'web']);
  });
});

describe('relations in the panel', () => {
  const rows = () => qa<HTMLElement>('#panel .rel').map((b) => b.textContent);

  it('lists incoming then outgoing links with their kind', () => {
    mount(panesPage);
    click(node('users'));
    expect(rows()).toEqual(['GET /users (reads)', 'teams (team_id)', 'legacy_roles (role_id)']);
  });

  it('a row jumps to that node as a history visit', () => {
    mount(panesPage);
    click(node('users'));
    click(qa('#panel .rel')[1]!);
    expect(q('.node.selected').getAttribute('data-id')).toBe('teams');
    expect(location.hash).toBe('#node=teams');
    expect(litIds(1)).toEqual(['teams', 'users']);
    click(q('#nav-back'));
    expect(q('.node.selected').getAttribute('data-id')).toBe('users');
  });

  it('a node without links has no list', () => {
    mount(panesPage);
    click(node('mailer'));
    expect(q('#panel h2').textContent).toContain('Mailer');
    expect(q('#panel .relations')).toBeNull();
  });

  it('flow steps list their links, labelled by the link', () => {
    mount(flowPage);
    click(node('mode'));
    expect(rows()).toEqual(['read file or stdin', 'print terminal map (cli)', 'write html file (web)', 'done (none)']);
  });
});

describe('relation notes', () => {
  const rows = (links: { from: string; to: string; label?: string; kind?: string }[]) =>
    [...relationsHtml(relationsOf('a', links, (id) => id.toUpperCase())).matchAll(/class="rel"[^>]*>([^<]*)</g)].map((m) => m[1]);

  it('say the label, else the kind, and nothing for a bare "other"', () => {
    expect(
      rows([
        { from: 'a', to: 'b', label: 'maps', kind: 'fk' },
        { from: 'a', to: 'c', kind: 'reads' },
        { from: 'd', to: 'a', kind: 'other' },
        { from: 'a', to: 'e', label: 'x', kind: 'other' },
        { from: 'a', to: 'f' },
      ]),
    ).toEqual(['D', 'B (maps)', 'C (reads)', 'E (x)', 'F']);
  });

  it('split into Used by (incoming, left) and Uses (outgoing, right) columns, none when a side is empty', () => {
    const html = relationsHtml(relationsOf('a', [{ from: 'a', to: 'b' }], (id) => id));
    expect(html).toContain('<h4>Uses \u2192</h4><ul>');
    expect(html).toContain('<h4>\u2190 Used by</h4><p class="rel-none">none</p>');
    expect(html.indexOf('Used by')).toBeLessThan(html.indexOf('Uses'));
    expect(relationsHtml([])).toBe('');
    expect(CSS).toContain('aside .relations{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))');
  });
});

describe('edge titles', () => {
  it('say from → to', () => {
    mount(panesPage);
    const edge = qa<Element>('.edge').find((e) => e.getAttribute('data-from') === 'users' && e.getAttribute('data-to') === 'teams')!;
    expect(edge.querySelector('title')?.textContent).toBe('users → teams');
  });

  it('use the labels of flow steps', () => {
    mount(flowPage);
    const edge = qa<Element>('.edge').find((e) => e.getAttribute('data-from') === 'mode' && e.getAttribute('data-to') === 'print')!;
    expect(edge.querySelector('title')?.textContent).toBe('output mode? → print terminal map');
  });
});

describe('selected node', () => {
  it('is the only one with .selected, while neighbours are just lit', () => {
    mount(shopPage);
    click(node('tbl.orders'));
    expect(qa('.node.selected').map((g) => g.getAttribute('data-id'))).toEqual(['tbl.orders']);
    expect(qa('.node.lit').length).toBeGreaterThan(1);
    expect(qa('.node.lit:not(.selected)').length).toBeGreaterThan(0);
  });

  it('gets a blue glow and a thicker outline that keep the status stroke, in both themes', () => {
    expect(CSS).toContain('.node.selected{filter:drop-shadow(0 0 6px color-mix(in srgb,var(--edge) 45%,transparent))');
    expect(CSS).toContain('.node.selected :is(.card,.shape){stroke-width:3}');
    expect(CSS).not.toMatch(/\.node\.selected[^{]*\{[^}]*stroke:/);
  });
});

describe('Focus button and f key', () => {
  const view = () => qa<SVGGElement>('.viewport').map((v) => v.getAttribute('transform'));
  const stub = (box = { x: 100, y: 50, width: 100, height: 40 }) => {
    (Object.getPrototypeOf(q('.node')) as Record<string, unknown>).getBBox = () => box;
    Element.prototype.getBoundingClientRect = () => ({ width: 1000, height: 800, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 800, toJSON: () => ({}) });
  };
  const settle = () => new Promise((r) => setTimeout(r, 400));

  it('a labelled button next to the history arrows, disabled until a node is selected', () => {
    mount(shopPage);
    const btn = q<HTMLButtonElement>('#panel-nav #nav-focus');
    expect(btn.getAttribute('aria-label')).toBe('Focus node (f)');
    expect(btn.title).toBe('Focus node (f)');
    expect(btn.disabled).toBe(true);
    click(node('tbl.orders'));
    expect(btn.disabled).toBe(false);
  });

  it('zooms the selected node to fill 60% of the pane, capped at 2.5x, and centres it', async () => {
    mount(shopPage);
    stub();
    click(node('tbl.orders'));
    click(q('#nav-focus'));
    await settle();
    expect(view()).toEqual(['translate(125,225) scale(2.5)']);
  });

  it('a big node zooms out to fit instead of past 60%', async () => {
    mount(shopPage);
    stub({ x: 0, y: 0, width: 2000, height: 100 });
    click(node('tbl.orders'));
    click(q('#nav-focus'));
    await settle();
    expect(view()).toEqual(['translate(200,385) scale(0.3)']);
  });

  it('f does the same, ignored while typing, with a modifier or with nothing selected', async () => {
    mount(shopPage);
    stub();
    const before = view();
    key('f');
    await settle();
    expect(view()).toEqual(before);
    click(node('tbl.orders'));
    const field = document.createElement('input');
    field.type = 'text';
    document.body.appendChild(field);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }));
    await settle();
    expect(view()).toEqual(before);
    key('f');
    await settle();
    expect(view()).toEqual(['translate(125,225) scale(2.5)']);
  });

  it('linked Now / After panes move together; the key help lists f', async () => {
    mount(panesPage);
    stub();
    click(node('users'));
    click(q('#nav-focus'));
    await settle();
    expect(new Set(view()).size).toBe(1);
    expect(view()[0]).toBe('translate(125,225) scale(2.5)');
    expect(q('#key-help').textContent).toContain('f: zoom to the selected node');
  });

  it('unlinked panes each focus the node, not only the last one', async () => {
    mount(panesPage);
    stub();
    click(q('#link-toggle'));
    click(node('users'));
    click(q('#nav-focus'));
    await settle();
    expect(view()).toEqual(['translate(125,225) scale(2.5)', 'translate(125,225) scale(2.5)']);
  });
});
