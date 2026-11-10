import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as readRegular from '../../src/read-regular.js';
import { checkExplain } from '../../src/render/explain-flows.js';
import { checkHeadline, checkTag } from '../../src/render/terminal/check-lines.js';
import { validateSpec } from '../../src/spec/schema.js';
import { withFlows } from '../fixtures/explain.js';
import { explainRepo } from '../helpers/explain-flows.js';

vi.mock('../../src/read-regular.js', { spy: true });

let repo: string;
beforeAll(() => {
  repo = explainRepo();
});
afterAll(() => vi.restoreAllMocks());

const check = (raw: object) => {
  const r = validateSpec(raw);
  if (!r.ok || r.spec.diagram === 'flow') throw new Error('fixture');
  return checkExplain(r.spec, repo);
};

describe('checkExplain', () => {
  it('counts a step once when both branches of its decision fail, and keeps both messages', () => {
    const raw = withFlows();
    raw.flows[0].links[1].match = 'Nope yes';
    raw.flows[0].links[2].match = 'Nope no';
    const c = check(raw);
    expect(c.mismatches).toHaveLength(1);
    expect(c.mismatches[0]).toMatchObject({ id: 'flow:create/zero', label: 'Create an invoice: Is the total zero?' });
    expect(c.mismatches[0]!.detail).toContain('"Nope yes" not found');
    expect(c.mismatches[0]!.detail).toContain('"Nope no" not found');
    expect(checkHeadline(c)).toBe("✗ 1 of 9 boxes and steps doesn't match the code");
    expect(checkTag(c)).toBe(' · ✓ 8 of 9 checked');
  });

  it('a step whose own anchor and branch both fail is still one', () => {
    const raw = withFlows();
    raw.flows[0].steps[1].match = 'Nope step';
    raw.flows[0].links[1].match = 'Nope yes';
    expect(check(raw).mismatches).toHaveLength(1);
  });

  it('reads a file shared by a box and a flow once: one context, one cache and one read budget', () => {
    const reads = vi.mocked(readRegular.readRegularFile);
    reads.mockClear();
    check(withFlows());
    const billing = reads.mock.calls.filter(([p]) => String(p).replaceAll('\\', '/').endsWith('app/billing.ts'));
    expect(billing).toHaveLength(1);
  });
});
