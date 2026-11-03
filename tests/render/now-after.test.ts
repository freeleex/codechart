// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { layoutSpec, PANE_CANVASES } from '../../src/render/web/layout.js';
import { renderHtml } from '../../src/render/web/html.js';
import { edgeChange, edgeOn, fieldsOn, hasNowAfter, nodeOn } from '../../src/render/web/states.js';
import { validateSpec, type Spec } from '../../src/spec/schema.js';

const raw = {
  title: 'Users join teams',
  kind: 'plan',
  nodes: [
    {
      id: 'users', label: 'users', kind: 'table', status: 'changed', layer: 'database', fieldsComplete: false,
      fields: [
        { name: 'id', type: 'uuid PK' },
        { name: 'legacy_role_id', type: 'int', change: 'removed' },
        { name: 'role', type: 'enum', was: 'text', change: 'modified' },
        { name: 'team_id', type: 'uuid FK teams', change: 'added' },
      ],
    },
    { id: 'legacy', label: 'legacy_roles', kind: 'table', status: 'removed', layer: 'database' },
    { id: 'teams', label: 'teams', kind: 'table', status: 'new', layer: 'database' },
    { id: 'api', label: 'GET /users', kind: 'endpoint', status: 'changed', layer: 'backend' },
    { id: 'svc', label: 'RoleService', kind: 'service', status: 'context', layer: 'backend' },
  ],
  edges: [
    { from: 'users', to: 'legacy', label: 'legacy_role_id', kind: 'fk' },
    { from: 'users', to: 'teams', label: 'team_id', kind: 'fk' },
    { from: 'api', to: 'svc', label: 'roles()', kind: 'calls', change: 'removed' },
    { from: 'api', to: 'users', label: 'reads', kind: 'reads', change: 'added' },
  ],
};

function load(input: unknown = raw): Spec {
  const r = validateSpec(structuredClone(input));
  if (!r.ok) throw new Error(r.errors.join('\n'));
  if (r.spec.diagram === 'flow') throw new Error('expected map spec');
  return r.spec;
}

const spec = load();
const meta = { generatedAt: new Date('2026-11-03T12:00:00Z'), repo: 'demo' };
const page = renderHtml(spec, await layoutSpec(spec, PANE_CANVASES), meta);

const statusOf = new Map(spec.nodes.map((n) => [n.id, n.status]));
const edgesOn = (side: 'now' | 'after') =>
  spec.edges.filter((e) => edgeOn(side, edgeChange(e, statusOf))).map((e) => `${e.from}>${e.to}`);
const node = (id: string) => spec.nodes.find((n) => n.id === id)!;

describe('now and after states', () => {
  it('Now leaves out new nodes, After leaves out removed ones', () => {
    expect(spec.nodes.filter((n) => nodeOn('now', n.status)).map((n) => n.id)).toEqual(['users', 'legacy', 'api', 'svc']);
    expect(spec.nodes.filter((n) => nodeOn('after', n.status)).map((n) => n.id)).toEqual(['users', 'teams', 'api', 'svc']);
  });

  it('edges to new or removed nodes fall on their side without a change; rewires use change', () => {
    expect(edgesOn('now')).toEqual(['users>legacy', 'api>svc']);
    expect(edgesOn('after')).toEqual(['users>teams', 'api>users']);
  });

  it('Now drops added fields and shows the old type; After drops removed fields', () => {
    const text = (fs: { name: string; type?: string }[]) => fs.map((f) => `${f.name}:${f.type}`);
    expect(text(fieldsOn('now', node('users')))).toEqual(['id:uuid PK', 'legacy_role_id:int', 'role:text']);
    expect(text(fieldsOn('after', node('users')))).toEqual(['id:uuid PK', 'role:enum', 'team_id:uuid FK teams']);
  });

  it('two panes only for a plan that touches existing code', () => {
    expect(hasNowAfter(spec)).toBe(true);
    const additive = load({
      ...raw,
      nodes: [raw.nodes[2], raw.nodes[4]],
      edges: [{ from: 'teams', to: 'svc' }],
    });
    expect(hasNowAfter(additive)).toBe(false);
    const rewire = load({ ...raw, nodes: [raw.nodes[3], raw.nodes[4]], edges: [{ from: 'api', to: 'svc', change: 'added' }] });
    expect(hasNowAfter(rewire)).toBe(true);
    expect(hasNowAfter({ ...spec, kind: 'summary', edges: [] })).toBe(false);
  });
});

describe('Now and After HTML', () => {
  const panes = () => [...document.querySelectorAll<HTMLElement>('.pane')];
  const ids = (pane: Element) => [...pane.querySelectorAll('.node')].map((g) => g.getAttribute('data-id'));
  const transforms = () => [...document.querySelectorAll('.viewport')].map((v) => v.getAttribute('transform'));

  beforeEach(() => {
    if (!('escape' in CSS)) {
      (CSS as { escape?: (s: string) => string }).escape = (s) => s.replace(/([^\w-])/g, '\\$1');
    }
    document.documentElement.innerHTML = page.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
    for (const s of document.querySelectorAll('script')) if (s.type !== 'application/json') new Function(s.textContent ?? '')();
  });

  it('draws a Now and an After pane with their own nodes', () => {
    expect(panes().map((p) => p.querySelector('.pane-title')?.firstChild?.textContent)).toEqual(['Now', 'After plan']);
    expect(ids(panes()[0]!)).toEqual(['users', 'legacy', 'api', 'svc']);
    expect(ids(panes()[1]!)).toEqual(['users', 'teams', 'api', 'svc']);
  });

  it('a node sits at the same place in both panes', () => {
    const rect = (pane: Element) => pane.querySelector('.node[data-id="users"] .card')!.outerHTML;
    expect(rect(panes()[0]!)).toBe(rect(panes()[1]!));
  });

  it('each pane title says what its colour means', () => {
    expect(panes().map((p) => p.querySelector('.pane-key')?.textContent)).toEqual([' · red: removed by the plan', ' · green: added by the plan']);
  });

  it('changed edges end in an arrow of their colour', () => {
    expect(panes()[0]!.querySelector('.edge-removed path')!.getAttribute('marker-end')).toBe('url(#arrow-removed)');
    expect(panes()[1]!.querySelector('.edge-added path')!.getAttribute('marker-end')).toBe('url(#arrow-added)');
    expect(document.querySelectorAll('marker#arrow-added, marker#arrow-removed')).toHaveLength(2);
  });

  it('tints the edges each side loses or gains', () => {
    expect(panes()[0]!.querySelectorAll('.edge-removed')).toHaveLength(2);
    expect(panes()[0]!.querySelectorAll('.edge-added')).toHaveLength(0);
    expect(panes()[1]!.querySelectorAll('.edge-added')).toHaveLength(2);
    expect(panes()[1]!.querySelectorAll('.edge-removed')).toHaveLength(0);
  });

  it('panning one pane moves both', () => {
    const before = transforms()[0];
    const canvas = panes()[1]!.querySelector('.canvas')!;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 60, clientY: 40 }));
    window.dispatchEvent(new PointerEvent('pointerup'));
    const [a, b] = transforms();
    expect(a).not.toBe(before);
    expect(a).toBe(b);
  });

  it('selecting a node selects it in both panes and lists fields now and after', () => {
    panes()[0]!.querySelector('.node[data-id="users"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelectorAll('.node.selected')).toHaveLength(2);
    const heads = [...document.querySelectorAll('#panel h3')].map((h) => h.textContent);
    expect(heads).toEqual(['Fields now', 'Fields after']);
    expect(document.querySelector('#panel')!.textContent).toContain('role: text');
  });

  it('the panel starts at half width, goes down to 200px and keeps its own saved size', () => {
    expect(page).toMatch(/#panes~aside\{width:clamp\(200px,17\.5vw,300px\);min-width:200px\}/);
    const handle = document.querySelector<HTMLElement>('#resize')!;
    handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1 }));
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: window.innerWidth - 50 }));
    expect(document.querySelector<HTMLElement>('aside')!.style.width).toBe('200px');
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
    expect(localStorage.getItem('codechart.panel.panes')).toBe('200');
    expect(localStorage.getItem('codechart.panel')).toBeNull();
    localStorage.removeItem('codechart.panel.panes');
  });

  it('a summary keeps one canvas, with explicit edge colours only', async () => {
    const summary = load({ ...raw, kind: 'summary', edges: raw.edges.slice(0, 2) });
    const out = renderHtml(summary, await layoutSpec(summary), meta);
    expect(out).not.toContain('class="pane"');
    expect(out).toContain('id="canvas"');
    expect(out).not.toContain('class="edge edge-');
    expect(out).toContain('role: text → enum');
  });
});
