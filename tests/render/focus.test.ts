// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { relationsHtml, relationsOf } from '../../src/render/web/tools.js';
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

  it('lists outgoing and incoming links with their kind', () => {
    mount(panesPage);
    click(node('users'));
    expect(rows()).toEqual(['← GET /users (reads)', '→ teams (team_id)', '→ legacy_roles (role_id)']);
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
    expect(rows()).toEqual(['← read file or stdin', '→ print terminal map (cli)', '→ write html file (web)', '→ done (none)']);
  });
});

describe('relation notes', () => {
  const rows = (links: { from: string; to: string; label?: string; kind?: string }[]) =>
    [...relationsHtml(relationsOf('a', links, (id) => id.toUpperCase())).matchAll(/>([→←][^<]*)</g)].map((m) => m[1]);

  it('say the label, else the kind, and nothing for a bare "other"', () => {
    expect(
      rows([
        { from: 'a', to: 'b', label: 'maps', kind: 'fk' },
        { from: 'a', to: 'c', kind: 'reads' },
        { from: 'd', to: 'a', kind: 'other' },
        { from: 'a', to: 'e', label: 'x', kind: 'other' },
        { from: 'a', to: 'f' },
      ]),
    ).toEqual(['→ B (maps)', '→ C (reads)', '← D', '→ E (x)', '→ F']);
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
