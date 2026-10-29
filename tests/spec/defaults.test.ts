import { describe, expect, it } from 'vitest';
import { flowJsonSchema } from '../../src/spec/flow.js';
import { specJsonSchema, validateSpec } from '../../src/spec/schema.js';

const flow = (steps: object[], links: object[], extra: object = {}) => ({
  kind: 'summary',
  title: 't',
  start: 'a',
  steps: steps.map((s) => ({ status: 'new', source: 'a.ts:1', ...s })),
  links,
  ...extra,
});

const ok = (input: unknown) => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.spec;
};
const errorsOf = (input: unknown) => {
  const r = validateSpec(input);
  if (r.ok) throw new Error('expected errors');
  return r.errors;
};

describe('flow defaults', () => {
  it('infers diagram: flow from steps and step types from outgoing links', () => {
    const spec = ok(
      flow(
        [
          { id: 'a', label: 'read input' },
          { id: 'b', label: 'valid?' },
          { id: 'c', label: 'reject' },
          { id: 'd', label: 'save' },
        ],
        [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'c', label: 'no', source: 'a.ts:2' },
          { from: 'b', to: 'd', label: 'yes', source: 'a.ts:3' },
        ],
      ),
    );
    expect(spec.diagram).toBe('flow');
    expect(spec.diagram === 'flow' && spec.steps.map((s) => s.type)).toEqual(['step', 'decision', 'end', 'end']);
  });

  it('keeps an explicit type', () => {
    const spec = ok(flow([{ id: 'a', label: 'x', type: 'step' }], [], { diagram: 'flow' }));
    expect(spec.diagram === 'flow' && spec.steps[0]!.type).toBe('step');
  });

  it('an inferred decision still needs labels and branch anchors', () => {
    expect(
      errorsOf(
        flow(
          [{ id: 'a', label: 'pick' }, { id: 'b', label: 'x' }, { id: 'c', label: 'y' }],
          [
            { from: 'a', to: 'b' },
            { from: 'a', to: 'c', label: 'y', source: 'a.ts:1' },
          ],
        ),
      ),
    ).toEqual([
      'links[0].source: required for a non-planned branch leaving a decision (path:line, path:start-end, or a path with match)',
      'links[0].label: required on a link leaving a decision',
    ]);
  });

  it.each([
    [0, []],
    [1, [{ from: 'a', to: 'b' }]],
  ])('a "?" label with %i outgoing link(s) and no type is an error', (n, links) => {
    expect(errorsOf(flow([{ id: 'a', label: 'valid?' }, { id: 'b', label: 'x' }], links)).filter((e) => e.startsWith('steps[0]'))).toEqual([
      `steps[0].type: label ends in "?", so this is a decision: it needs at least 2 outgoing links, has ${n}`,
    ]);
  });

  it('explicit step and decision link-count lints stay', () => {
    const links = [
      { from: 'a', to: 'b', label: 'p', source: 'a.ts:1' },
      { from: 'a', to: 'c', label: 'q', source: 'a.ts:1' },
    ];
    const steps = [{ id: 'a', label: 'x', type: 'step' }, { id: 'b', label: 'y' }, { id: 'c', label: 'z' }];
    expect(errorsOf(flow(steps, links))).toEqual(['steps[0].type: has 2 outgoing links; make it a decision with labelled branches']);
    expect(errorsOf(flow([{ id: 'a', label: 'x', type: 'decision' }, { id: 'b', label: 'y' }], [links[0]!]))).toEqual([
      'steps[0].id: decision "a" needs at least 2 outgoing links, has 1',
    ]);
  });

  it('a spec without steps and diagram stays a map', () => {
    expect(ok({ title: 't', kind: 'summary', nodes: [], edges: [] }).diagram).toBeUndefined();
  });

  it('diagram: map with steps is rejected, not treated as a flow', () => {
    expect(errorsOf({ ...flow([], []), diagram: 'map' }).join('\n')).toContain('Unrecognized key');
  });

  it('the flow JSON schema no longer requires diagram or type', () => {
    const schema = flowJsonSchema() as { required: string[]; properties: { steps: { items: { required: string[] } } } };
    expect(schema.required).not.toContain('diagram');
    expect(schema.properties.steps.items.required).not.toContain('type');
  });
});

describe('map defaults', () => {
  const map = (node: object) => ({ title: 't', kind: 'summary', nodes: [{ id: 'n', label: 'n', status: 'new', layer: 'l', ...node }], edges: [] });

  it('kind defaults to file when path is set', () => {
    const spec = ok(map({ path: 'src/a.ts' }));
    expect(spec.diagram !== 'flow' && spec.nodes[0]!.kind).toBe('file');
  });

  it('kind is required without path', () => {
    expect(errorsOf(map({}))).toEqual(['nodes[0].kind: required unless path is set (then it defaults to "file")']);
  });

  it('an explicit kind wins', () => {
    const spec = ok(map({ path: 'src/a.ts', kind: 'service' }));
    expect(spec.diagram !== 'flow' && spec.nodes[0]!.kind).toBe('service');
  });

  it('the map JSON schema no longer requires kind', () => {
    const schema = specJsonSchema() as { properties: { nodes: { items: { required: string[] } } } };
    expect(schema.properties.nodes.items.required).not.toContain('kind');
  });
});
