import { describe, expect, it } from 'vitest';
import { specJsonSchema, validateAnySpec } from '../../src/spec/schema.js';
import { explain } from '../fixtures/explain.js';

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
});
