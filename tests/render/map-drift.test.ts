import { describe, expect, it } from 'vitest';
import { compareMaps } from '../../src/render/map-drift.js';
import type { Spec, SpecEdge, SpecNode } from '../../src/spec/schema.js';

const node = (id: string, status: SpecNode['status'], extra: Partial<SpecNode> = {}): SpecNode => ({ id, label: id, kind: 'other', status, layer: 'l', ...extra });
const map = (kind: Spec['kind'], nodes: SpecNode[], extra: Partial<Spec> = {}): Spec => ({ title: 'T', kind, nodes, edges: [], ...extra });
const plan = (nodes: SpecNode[], edges: SpecEdge[] = []) => ({ spec: map('plan', nodes, { edges }), savedAt: '2026-11-06T10:00:00.000Z' });
const summary = (nodes: SpecNode[], extra: Partial<Spec> = {}) => map('summary', nodes, extra);
const brief = (d: ReturnType<typeof compareMaps>) => d.items.map((i) => [i.kind, i.id, i.detail]);

describe('compareMaps', () => {
  it('reports no drift for a build that matches, whatever the wording', () => {
    const p = plan([node('a', 'new', { summary: 'x', notes: ['n'] }), node('b', 'context')]);
    const s = summary([node('a', 'new', { label: 'renamed', summary: 'y' }), node('b', 'context')]);
    const d = compareMaps(p, s);
    expect(d.items).toEqual([]);
    expect(d.plan).toEqual({ title: 'T', savedAt: '2026-11-06T10:00:00.000Z' });
  });

  it.each(['new', 'changed', 'removed', 'config'] as const)('a planned %s node nobody built is missing, with its ghost', (status) => {
    const ghost = node('a', status);
    const d = compareMaps(plan([ghost]), summary([]));
    const change = { new: 'add', changed: 'change', removed: 'remove', config: 'change' }[status];
    expect(d.items).toEqual([{ id: 'a', label: 'a', noun: 'node', change, kind: 'missing', ghost }]);
  });

  it.each(['new', 'changed', 'removed', 'config'] as const)('a built %s node nobody planned is unplanned', (status) => {
    expect(brief(compareMaps(plan([]), summary([node('z', status)])))).toEqual([['unplanned', 'z', undefined]]);
  });

  it('ignores context nodes on both sides, but a built change on a planned context node is unplanned', () => {
    const d = compareMaps(plan([node('a', 'context'), node('b', 'context')]), summary([node('a', 'context'), node('b', 'changed'), node('c', 'context')]));
    expect(brief(d)).toEqual([['unplanned', 'b', undefined]]);
  });

  it('a planned change the summary calls unchanged is missing', () => {
    expect(brief(compareMaps(plan([node('a', 'changed')]), summary([node('a', 'context')])))).toEqual([['missing', 'a', 'left unchanged']]);
  });

  it('a missing node paired with a built one has no ghost: the real node carries it', () => {
    const d = compareMaps(plan([node('a', 'new', { path: 'a.ts' })]), summary([node('z', 'context', { path: 'a.ts' })]));
    expect(d.items).toEqual([{ id: 'z', label: 'a', noun: 'node', change: 'add', kind: 'missing', detail: 'left unchanged' }]);
  });

  it('matches by path when the ids differ, and keeps the plan id as an alias for reasons', () => {
    const p = plan([node('orders', 'changed', { path: 'app/orders.py' })]);
    const s = summary([node('order-model', 'changed', { path: './app/orders.py' })], { drift: [] });
    expect(compareMaps(p, s).items).toEqual([]);
    const moved = summary([node('order-model', 'changed', { path: 'app/orders.py', fields: [{ name: 'x', change: 'added' }], fieldsComplete: false })], {
      drift: [{ node: 'orders', cause: 'cleaner-way', why: 'merged' }],
    });
    const d = compareMaps(p, moved);
    expect(d.items).toMatchObject([{ kind: 'different', id: 'order-model', cause: 'cleaner-way', why: 'merged' }]);
    expect(d.strayReasons).toEqual([]);
  });

  it('a path match needs the same match text when both have one', () => {
    const p = plan([node('a', 'changed', { path: 'f.py', match: 'def a' })]);
    const s = summary([node('b', 'changed', { path: 'f.py', match: 'def b' })]);
    expect(brief(compareMaps(p, s))).toEqual([['missing', 'a', undefined], ['unplanned', 'b', undefined]]);
    expect(compareMaps(p, summary([node('b', 'changed', { path: 'f.py' })])).items).toEqual([]);
  });

  it('a built node pairs with one plan node only', () => {
    const p = plan([node('a', 'new', { path: 'f.py' }), node('b', 'new', { path: 'f.py' })]);
    expect(brief(compareMaps(p, summary([node('x', 'new', { path: 'f.py' })])))).toEqual([['missing', 'b', undefined]]);
  });

  it('differs on path, status and changed fields', () => {
    const f = (type: string) => ({ fields: [{ name: 'total', type, change: 'modified' as const }], fieldsComplete: false });
    const p = plan([node('a', 'changed', { path: 'a.py', ...f('int') }), node('b', 'new'), node('c', 'changed', f('int'))]);
    const s = summary([node('a', 'changed', { path: 'b.py', ...f('decimal') }), node('b', 'changed'), node('c', 'changed', f('int'))]);
    expect(brief(compareMaps(p, s))).toEqual([
      ['different', 'a', 'path a.py → b.py, field total: int → decimal'],
      ['different', 'b', 'status new → changed'],
    ]);
  });

  it('names fields built or planned only, and caps the list', () => {
    const fields = (...names: string[]) => ({ fields: names.map((name) => ({ name })), fieldsComplete: true });
    const p = plan([node('a', 'new', fields('x', 'y', 'z'))]);
    expect(compareMaps(p, summary([node('a', 'new', fields('x', 'w'))])).items[0]!.detail).toBe('field y not built, field z not built, +1 more');
  });

  it("a planned added link between built nodes that isn't there is different on its from node", () => {
    const nodes = [node('a', 'context'), node('b', 'context')];
    const edge: SpecEdge = { from: 'a', to: 'b', change: 'added' };
    expect(brief(compareMaps(plan(nodes, [edge]), summary(nodes)))).toEqual([['different', 'a', 'link to b not built']]);
    expect(compareMaps(plan(nodes, [edge]), summary(nodes, { edges: [{ from: 'a', to: 'b' }] })).items).toEqual([]);
  });

  it('a missing link adds to its node\'s other differences, and is skipped when an end is missing', () => {
    const p = plan([node('a', 'changed'), node('b', 'new')], [{ from: 'a', to: 'b', change: 'added' }]);
    expect(brief(compareMaps(p, summary([node('a', 'changed')])))).toEqual([['missing', 'b', undefined]]);
    const both = compareMaps(p, summary([node('a', 'config'), node('b', 'new')]));
    expect(brief(both)).toEqual([['different', 'a', 'status changed → config, link to b not built']]);
  });

  it('joins reasons by id, counts the unexplained and lists reasons for what did not drift', () => {
    const p = plan([node('a', 'new'), node('b', 'new')]);
    const s = summary([node('c', 'new')], {
      drift: [
        { node: 'a', cause: 'bug-found', why: 'it broke' },
        { node: 'c', cause: 'user-asked', why: 'asked' },
        { node: 'ghost', cause: 'other', why: 'nothing' },
      ],
    });
    const d = compareMaps(p, s);
    expect(d.items.map((i) => [i.id, i.cause, i.why])).toEqual([['a', 'bug-found', 'it broke'], ['b', undefined, undefined], ['c', 'user-asked', 'asked']]);
    expect(d.unexplained).toBe(1);
    expect(d.strayReasons).toEqual(['ghost']);
  });
});
