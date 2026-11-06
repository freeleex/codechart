import { describe, expect, it } from 'vitest';
import { validateFlowSpec } from '../../src/spec/flow.js';
import { validateSpec } from '../../src/spec/schema.js';

const reason = { cause: 'bug-found', why: 'the lock was needed' };
const map = (kind: string, drift?: unknown) => ({
  title: 't',
  kind,
  nodes: [{ id: 'a', label: 'a', kind: 'other', status: 'new', layer: 'l' }],
  edges: [],
  ...(drift !== undefined && { drift }),
});
const flow = (kind: string, drift?: unknown) => ({
  kind,
  title: 't',
  start: 's',
  steps: [kind === 'plan' ? { id: 's', label: 'start', status: 'planned' } : { id: 's', label: 'start', status: 'new', source: 'a.ts:1' }],
  links: [],
  ...(drift !== undefined && { drift }),
});

const errorsOf = (r: { ok: boolean; errors?: string[] }) => {
  if (r.ok) throw new Error('expected validation failure');
  return r.errors!;
};

describe('map drift', () => {
  it('is accepted on a summary', () => {
    expect(validateSpec(map('summary', [{ node: 'a', ...reason }])).ok).toBe(true);
  });

  it('is rejected on a plan', () => {
    expect(errorsOf(validateSpec(map('plan', [{ node: 'a', ...reason }])))).toEqual(['drift: only in a summary: it says how the build differs from the plan']);
  });

  it('needs a reason and a known cause', () => {
    const errors = errorsOf(validateSpec(map('summary', [{ node: 'a', cause: 'bug-found' }, { node: 'a', cause: 'nope', why: 'x' }])));
    expect(errors.some((e) => e.startsWith('drift[0].why:'))).toBe(true);
    expect(errors.some((e) => e.startsWith('drift[1].cause:'))).toBe(true);
  });

  it('takes a reason of up to 400 characters and no more', () => {
    expect(validateSpec(map('summary', [{ node: 'a', cause: 'other', why: 'x'.repeat(400) }])).ok).toBe(true);
    expect(errorsOf(validateSpec(map('summary', [{ node: 'a', cause: 'other', why: 'x'.repeat(401) }])))[0]).toMatch(/^drift\[0\]\.why:/);
  });

  it('takes one entry per node', () => {
    expect(errorsOf(validateSpec(map('summary', [{ node: 'a', ...reason }, { node: 'a', ...reason }])))).toEqual(['drift[1]: duplicate "a"']);
  });

  it('rejects a hidden character in the reason', () => {
    expect(errorsOf(validateSpec(map('summary', [{ node: 'a', cause: 'other', why: 'x‮y' }])))).toContain('drift[0].why: must not contain control or invisible characters');
  });
});

describe('flow drift', () => {
  it('is accepted on a summary, keyed by step', () => {
    expect(validateFlowSpec(flow('summary', [{ step: 's', ...reason }])).ok).toBe(true);
  });

  it('is rejected on a plan', () => {
    expect(errorsOf(validateFlowSpec(flow('plan', [{ step: 's', ...reason }])))).toEqual(['drift: only in a summary: it says how the build differs from the plan']);
  });

  it('does not take a node key', () => {
    expect(validateFlowSpec(flow('summary', [{ node: 's', ...reason }])).ok).toBe(false);
  });
});
