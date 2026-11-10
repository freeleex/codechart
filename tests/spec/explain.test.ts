import { describe, expect, it } from 'vitest';
import { specJsonSchema, validateAnySpec } from '../../src/spec/schema.js';
import { explain, withFlows } from '../fixtures/explain.js';

const errors = (spec: unknown): string[] => {
  const r = validateAnySpec(spec);
  return r.ok ? [] : r.errors;
};

describe('explain spec', () => {
  it('accepts existing and outside boxes, an outside box without a path, fields, notes, gaps and layers', () => {
    const spec = explain();
    spec.nodes[0].fields = [{ name: 'total', type: 'int' }];
    spec.nodes[0].fieldsComplete = false;
    expect(errors(spec)).toEqual([]);
  });

  it('needs a path on an existing box', () => {
    const spec = explain();
    delete spec.nodes[0].path;
    delete spec.nodes[0].match;
    expect(errors(spec)).toEqual([expect.stringMatching(/^nodes\[0\]\.path: required for "existing"/)]);
  });

  it.each(['new', 'changed', 'removed', 'config', 'context'])('rejects the change status %s', (status) => {
    const spec = explain();
    spec.nodes[1].status = status;
    expect(errors(spec)).toEqual([expect.stringContaining(`nodes[1].status: an explain map uses "existing" or "outside", not "${status}"`)]);
  });

  it('rejects the plan and summary extras: edge change, field change and was, drift, omitted', () => {
    const spec = explain();
    spec.edges[0].change = 'added';
    spec.nodes[0].fields = [{ name: 'total', type: 'int', change: 'modified', was: 'text' }];
    spec.nodes[0].fieldsComplete = true;
    spec.drift = [{ node: 'api', cause: 'other', why: 'x' }];
    spec.omitted = ['tests'];
    const found = errors(spec).map((e) => e.split(':')[0]);
    expect(found).toEqual(expect.arrayContaining(['edges[0].change', 'nodes[0].fields[0].change', 'drift', 'omitted']));
  });

  it.each(['plan', 'summary'])('rejects existing and outside in a %s', (kind) => {
    const spec = { title: 'T', kind, nodes: explain().nodes.slice(0, 3), edges: [] };
    const found = errors(spec);
    expect(found).toHaveLength(3);
    expect(found[0]).toMatch(/^nodes\[0\]\.status: "existing" is only for a map with "kind": "explain"/);
    expect(found[2]).toMatch(/^nodes\[2\]\.status: "outside" is only for/);
  });

  it('still needs a kind on a box without a path', () => {
    const spec = explain();
    delete spec.nodes[3].kind;
    expect(errors(spec)).toEqual([expect.stringContaining('nodes[3].kind: required unless path is set')]);
  });

  it('the JSON schema lists the explain kind and both statuses', () => {
    const schema = JSON.stringify(specJsonSchema());
    expect(schema).toContain('"explain"');
    expect(schema).toContain('"existing"');
    expect(schema).toContain('"outside"');
  });

  describe('flows', () => {
    it('accepts flows with steps in boxes, decisions with labelled branches, gaps and steps in no box', () => {
      expect(errors(withFlows())).toEqual([]);
    });

    it('accepts up to 5 flows and rejects a sixth', () => {
      const spec = withFlows();
      const one = spec.flows[1];
      spec.flows = Array.from({ length: 5 }, (_, i) => ({ ...one, id: `f${i}` }));
      expect(errors(spec)).toEqual([]);
      spec.flows.push({ ...one, id: 'f5' });
      expect(errors(spec)).toEqual([expect.stringMatching(/^flows: at most 5 flows/)]);
    });

    it.each(['plan', 'summary'])('rejects flows in a %s', (kind) => {
      const spec = { title: 'T', kind, nodes: [], edges: [], flows: withFlows().flows };
      expect(errors(spec)).toEqual(['flows: only in a map with "kind": "explain"']);
    });

    it('names the flow and the step of a box that is not on the map', () => {
      const spec = withFlows();
      spec.flows[1].steps[1].box = 'nope';
      expect(errors(spec)).toEqual(['flows[1].steps[1].box: flow "receipt", step "mail": unknown box "nope"']);
    });

    it('refuses a "/" in a flow id, so step ids on the page (flow:<id>/<step>) stay unique', () => {
      const spec = withFlows();
      spec.flows[1].id = 'a/b';
      expect(errors(spec)).toEqual(['flows[1].id: must not contain "/": step ids on the page are flow:<id>/<step id>']);
      spec.flows[1].id = 'a';
      spec.flows[1].steps[0].id = 'b/c';
      spec.flows[1].start = 'b/c';
      spec.flows[1].links[0].from = 'b/c';
      expect(errors(spec)).toEqual([]);
    });

    it('rejects a duplicate flow id', () => {
      const spec = withFlows();
      spec.flows[1].id = 'create';
      expect(errors(spec)).toEqual(['flows[1].id: duplicate "create"']);
    });

    it.each(['new', 'changed', 'planned', 'removed'])('allows only existing steps, not %s', (status) => {
      const spec = withFlows();
      spec.flows[1].steps[1].status = status;
      expect(errors(spec).join('\n')).toContain('flows[1].steps[1].status');
    });

    it('rejects the plan-only link flags', () => {
      const spec = withFlows();
      spec.flows[1].links[0].planned = true;
      expect(errors(spec).join('\n')).toContain('flows[1].links[0]');
    });

    it('rejects a step without an anchor, and a branch out of a decision without a label or an anchor', () => {
      const spec = withFlows();
      delete spec.flows[0].steps[0].source;
      delete spec.flows[0].steps[0].match;
      delete spec.flows[0].links[1].label;
      delete spec.flows[0].links[2].source;
      delete spec.flows[0].links[2].match;
      expect(errors(spec)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^flows\[0\]\.steps\[0\]\.source: required for a non-planned step/),
          'flows[0].links[1].label: required on a link leaving a decision',
          expect.stringMatching(/^flows\[0\]\.links\[2\]\.source: required for a non-planned branch/),
        ]),
      );
    });

    it('rejects an anchor with a line and a match, an unknown start and an unreachable step', () => {
      const spec = withFlows();
      spec.flows[1].steps[0].source = 'app/billing.ts:3';
      spec.flows[1].start = 'gone';
      spec.flows[0].links.pop();
      const found = errors(spec).join('\n');
      expect(found).toContain('flows[1].steps[0].source: with match, give only the path');
      expect(found).toContain('flows[1].start: unknown step "gone"');
      expect(found).toContain('flows[0].steps[3]: not reachable from start');
    });

    it('rejects a box id that starts like a step id, when there are flows', () => {
      const spec = withFlows();
      spec.nodes[0].id = 'flow:api';
      spec.edges[0].from = 'flow:api';
      expect(errors(spec).join('\n')).toContain('nodes[0].id: "flow:" is reserved for flow steps');
      delete spec.flows;
      expect(errors(spec)).toEqual([]);
    });

    it('types the steps from their links', () => {
      const r = validateAnySpec(withFlows());
      if (!r.ok || !('flows' in r.spec)) throw new Error('fixture');
      expect(r.spec.flows![0]!.steps.map((s) => s.type)).toEqual(['step', 'decision', 'end', 'end']);
    });

    it('the JSON schema lists flows with a box on a step', () => {
      const schema = JSON.stringify(specJsonSchema());
      expect(schema).toContain('"flows"');
      expect(schema).toContain('The id of the box this step happens in');
      expect(schema).toContain('"maxItems":5');
    });
  });
});
