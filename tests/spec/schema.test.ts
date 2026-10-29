import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { specJsonSchema, validateSpec } from '../../src/spec/schema.js';

const load = () =>
  JSON.parse(
    readFileSync(new URL('../fixtures/shop.spec.json', import.meta.url), 'utf8'),
  );

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;

const errorsOf = (input: unknown) => {
  const r = validateSpec(input);
  if (r.ok) throw new Error('expected validation failure');
  return r.errors;
};

describe('invisible characters in ids', () => {
  it('rejects a node id that only differs by a bidi mark', () => {
    const s: J = load();
    s.nodes[1].id = `${s.nodes[0].id}\u202e`;
    expect(errorsOf(s)).toContain('nodes[1].id: must not contain control or invisible characters');
  });

  it('rejects edge ends with hidden characters', () => {
    const s: J = load();
    s.edges[0].to = `${s.nodes[0].id}\u200d`;
    expect(errorsOf(s)).toContain('edges[0].to: must not contain control or invisible characters');
  });
});

describe('validateSpec', () => {
  it('valid fixture passes', () => {
    const r = validateSpec(load());
    expect(r.ok).toBe(true);
  });

  describe('label readability', () => {
    const withLabel = (label: string) => {
      const s = load();
      s.nodes[0].label = label;
      return s;
    };

    it('rejects a hash token in a label', () => {
      expect(errorsOf(withLabel('a91f0c2e7b45_add_invoices'))).toContain(
        'nodes[0].label: looks like a hash or file name ("a91f0c2e7b45"); label it by what it is (e.g. "migration: add invoices") and put the file in path',
      );
      expect(errorsOf(withLabel('migration A1B2C3D4E5F6'))[0]).toContain('("A1B2C3D4E5F6")');
    });

    it('rejects merged entities', () => {
      expect(errorsOf(withLabel('Team / User / Project'))).toContain(
        'nodes[0].label: one node per entity; split "Team / User / Project" into separate nodes',
      );
      expect(errorsOf(withLabel('User + Project'))).toHaveLength(1);
    });

    it.each([
      'GET /users/{id}',
      'C++',
      'user.py',
      'migration: add teams',
      'sha256 helper',
      'deadbeef',
      '1234567',
      'abc123',
    ])('allows %s', (label) => {
      expect(validateSpec(withLabel(label)).ok).toBe(true);
    });
  });

  describe('fieldsComplete', () => {
    it('fields without fieldsComplete → error', () => {
      const s = load();
      delete s.nodes[0].fieldsComplete;
      expect(errorsOf(s)).toEqual([
        'nodes[0].fieldsComplete: required when fields are listed (true if you listed every field, false if only what you saw)',
      ]);
    });

    it('not required without fields or with empty fields', () => {
      const s = load();
      delete s.nodes[0].fieldsComplete;
      s.nodes[0].fields = [];
      delete s.nodes[1].fieldsComplete;
      delete s.nodes[1].fields;
      expect(validateSpec(s).ok).toBe(true);
    });

    it('must be boolean', () => {
      const s = load();
      s.nodes[0].fieldsComplete = 'yes';
      expect(errorsOf(s).some((e) => e.startsWith('nodes[0].fieldsComplete:'))).toBe(true);
    });

    it('fixture sets fieldsComplete on every node with fields', () => {
      for (const n of load().nodes) {
        if (n.fields?.length) expect(typeof n.fieldsComplete).toBe('boolean');
      }
    });
  });

  it('edge to unknown node', () => {
    const s = load();
    s.edges[0].to = 'tbl.nope';
    expect(errorsOf(s)).toContain('edges[0].to: unknown node "tbl.nope"');
  });

  it('edge from unknown node', () => {
    const s = load();
    s.edges[1].from = 'tbl.nope';
    expect(errorsOf(s)).toContain('edges[1].from: unknown node "tbl.nope"');
  });

  it('duplicate node id', () => {
    const s = load();
    s.nodes[3].id = 'tbl.orders';
    expect(errorsOf(s)).toContain('nodes[3].id: duplicate "tbl.orders"');
  });

  it('removed status validates', () => {
    const s = load();
    s.nodes[0].status = 'removed';
    expect(validateSpec(s).ok).toBe(true);
  });

  it('bad status', () => {
    const s = load();
    s.nodes[0].status = 'bogus';
    expect(errorsOf(s).some((e) => e.startsWith('nodes[0].status'))).toBe(true);
  });

  it('errors are one line "<path>: <message>"', () => {
    const errs = errorsOf({ nodes: 'x' });
    for (const e of errs) expect(e).toMatch(/^[^\n:]+: [^\n]+$/);
  });

  it.each([
    ['top level', (s: J) => (s.bogus = 1), 'bogus'],
    ['node', (s: J) => (s.nodes[0].bogus = 1), 'bogus'],
    ['field', (s: J) => (s.nodes[0].fields[0].bogus = 1), 'bogus'],
    ['edge', (s: J) => (s.edges[0].bogus = 1), 'bogus'],
  ])('rejects unknown key at %s', (_where, mutate, key) => {
    const s = load();
    mutate(s);
    expect(errorsOf(s).some((e) => e.includes(key))).toBe(true);
  });

  it('non-object input fails with root path', () => {
    expect(errorsOf(null)).toHaveLength(1);
  });
});

describe('specJsonSchema', () => {
  it('forbids extra properties on root, node, field and edge', () => {
    const js = specJsonSchema() as J;
    const node = js.properties.nodes.items;
    expect(js.additionalProperties).toBe(false);
    expect(node.additionalProperties).toBe(false);
    expect(node.properties.fields.items.additionalProperties).toBe(false);
    expect(js.properties.edges.items.additionalProperties).toBe(false);
  });

  it('json schema exposes status enum', () => {
    const text = JSON.stringify(specJsonSchema());
    for (const s of ['new', 'changed', 'context', 'config']) {
      expect(text).toContain(`"${s}"`);
    }
  });
});
