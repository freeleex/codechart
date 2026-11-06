import { describe, expect, it } from 'vitest';
import { compareFlows } from '../../src/render/flow/drift.js';
import type { FlowLink, FlowSpec, FlowStep } from '../../src/spec/flow.js';

const step = (id: string, status: FlowStep['status'], extra: Partial<FlowStep> = {}): FlowStep => ({
  id,
  label: id,
  type: 'step',
  status,
  ...(status === 'planned' ? {} : { source: `${id}.ts:1` }),
  ...extra,
});
const flow = (kind: FlowSpec['kind'], steps: FlowStep[], links: FlowLink[] = [], extra: Partial<FlowSpec> = {}): FlowSpec => ({
  diagram: 'flow',
  kind,
  title: 'F',
  start: steps[0]!.id,
  steps,
  links,
  ...extra,
});
const plan = (steps: FlowStep[], links: FlowLink[] = []) => ({ spec: flow('plan', steps, links), savedAt: '2026-11-06T10:00:00.000Z' });
const brief = (d: ReturnType<typeof compareFlows>) => d.items.map((i) => [i.kind, i.id, i.detail]);

describe('compareFlows', () => {
  it('reports no drift for a build that matches', () => {
    const p = plan([step('a', 'existing'), step('b', 'planned')], [{ from: 'a', to: 'b' }]);
    const s = flow('summary', [step('a', 'existing'), step('b', 'new', { label: 'other words' })], [{ from: 'a', to: 'b' }]);
    expect(compareFlows(p, s).items).toEqual([]);
  });

  it('a planned step nobody built is missing, with its ghost', () => {
    const ghost = step('b', 'planned');
    const d = compareFlows(plan([step('a', 'existing'), ghost]), flow('summary', [step('a', 'existing')]));
    expect(d.items).toEqual([{ id: 'b', label: 'b', noun: 'step', change: 'add', kind: 'missing', ghost }]);
  });

  it('a planned step the summary calls existing is missing; a removed one still there is not removed', () => {
    const p = plan([step('a', 'existing'), step('b', 'planned', { source: 'b.ts:1' }), step('c', 'removed')]);
    const s = flow('summary', [step('a', 'existing'), step('b', 'existing'), step('c', 'changed')]);
    expect(brief(compareFlows(p, s))).toEqual([['missing', 'b', 'left unchanged'], ['missing', 'c', 'removal not done']]);
  });

  it('a missing step paired with a built one has no ghost', () => {
    const p = plan([step('a', 'existing'), step('c', 'removed')]);
    const items = compareFlows(p, flow('summary', [step('a', 'existing'), step('c', 'changed')])).items;
    expect(items).toEqual([{ id: 'c', label: 'c', noun: 'step', change: 'remove', kind: 'missing', detail: 'removal not done' }]);
  });

  it('a removed step that is gone is built as planned', () => {
    expect(compareFlows(plan([step('a', 'existing'), step('c', 'removed')]), flow('summary', [step('a', 'existing')])).items).toEqual([]);
  });

  it('a new step the plan lacks, or kept as existing, is unplanned; a changed one the plan kept is different', () => {
    const p = plan([step('a', 'existing'), step('b', 'existing')]);
    const s = flow('summary', [step('a', 'new'), step('b', 'changed'), step('z', 'changed'), step('y', 'existing')]);
    expect(brief(compareFlows(p, s))).toEqual([['unplanned', 'a', undefined], ['different', 'b', 'changed, plan kept it'], ['unplanned', 'z', undefined]]);
  });

  it('matches by source when the ids differ, and the plan id still carries a reason', () => {
    const p = plan([step('a', 'existing', { source: 'x.ts', match: 'if (a)' }), step('p', 'planned')]);
    const s = flow('summary', [step('first', 'existing', { source: 'x.ts', match: 'if (a)' })], [], {
      drift: [{ step: 'p', cause: 'out-of-scope', why: 'later' }],
    });
    const d = compareFlows(p, s);
    expect(d.items).toMatchObject([{ id: 'p', kind: 'missing', cause: 'out-of-scope' }]);
    expect(d.unexplained).toBe(0);
    const other = flow('summary', [step('first', 'new', { source: 'x.ts', match: 'if (b)' })]);
    expect(brief(compareFlows(p, other))).toEqual([['missing', 'p', undefined], ['unplanned', 'first', undefined]]);
  });

  it("a planned link between built steps that isn't there is different on its from step", () => {
    const steps = [step('a', 'existing'), step('b', 'existing', { source: 'b.ts:1' })];
    const link: FlowLink = { from: 'a', to: 'b', planned: true };
    expect(brief(compareFlows(plan(steps, [link]), flow('summary', steps)))).toEqual([['different', 'a', 'link to b not built']]);
    expect(compareFlows(plan(steps, [link]), flow('summary', steps, [{ from: 'a', to: 'b' }])).items).toEqual([]);
  });

  it('a link to a planned step nobody built is not reported twice', () => {
    const p = plan([step('a', 'existing'), step('b', 'planned')], [{ from: 'a', to: 'b' }]);
    expect(brief(compareFlows(p, flow('summary', [step('a', 'existing')])))).toEqual([['missing', 'b', undefined]]);
  });

  it('joins reasons, counts the unexplained and lists the stray ones', () => {
    const p = plan([step('a', 'existing'), step('b', 'planned'), step('c', 'planned')]);
    const s = flow('summary', [step('a', 'existing')], [], { drift: [{ step: 'b', cause: 'bug-found', why: 'it broke' }, { step: 'a', cause: 'other', why: 'x' }] });
    const d = compareFlows(p, s);
    expect(d.items.map((i) => [i.id, i.cause])).toEqual([['b', 'bug-found'], ['c', undefined]]);
    expect(d.unexplained).toBe(1);
    expect(d.strayReasons).toEqual(['a']);
  });
});
