import { beforeEach, describe, expect, it, vi } from 'vitest';

let calls = 0;
let list: () => string[] = () => [];
vi.mock('../../src/rules/git-files.js', () => ({
  gitListFiles: () => {
    calls++;
    return list();
  },
  gitFileAt: vi.fn(),
}));

const { checkFlowAnchors } = await import('../../src/render/flow/anchors.js');
type Spec = Parameters<typeof checkFlowAnchors>[0];

const missing = (n: number): Spec => ({
  diagram: 'flow',
  kind: 'summary',
  title: 't',
  start: 's0',
  steps: Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    label: 'a step',
    type: 'step' as const,
    status: 'existing' as const,
    source: `nope/missing${i}.ts:1`,
  })),
  links: [],
});

const errors = (s: Spec) => {
  const r = checkFlowAnchors(s, process.cwd());
  if (r.ok) throw new Error('expected errors');
  return r.errors;
};

beforeEach(() => {
  calls = 0;
});

describe('likelyPath listing', () => {
  it('lists once even when git throws', () => {
    list = () => {
      throw new Error('boom');
    };
    const e = errors(missing(3));
    expect(e).toHaveLength(3);
    expect(e.join()).not.toContain('did you mean');
    expect(calls).toBe(1);
  });

  it('gives no hint for a listing over 200000 entries', () => {
    list = () => Array.from({ length: 200_001 }, (_, i) => (i === 0 ? 'x/nope/missing0.ts' : `f${i}`));
    expect(errors(missing(2)).join()).not.toContain('did you mean');
    expect(calls).toBe(1);
  });

  it('hints from a normal listing', () => {
    list = () => ['x/nope/missing0.ts'];
    expect(errors(missing(1))[0]).toContain('did you mean x/nope/missing0.ts');
  });
});
