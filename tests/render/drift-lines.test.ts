import { describe, expect, it } from 'vitest';
import type { Drift, DriftItem } from '../../src/render/drift.js';
import { ageText, driftBlock } from '../../src/render/terminal/drift-lines.js';
import { columns } from '../../src/render/terminal/wrap.js';

const now = new Date('2026-11-06T12:00:00Z');
const savedAt = '2026-11-06T10:00:00Z';
const item = (id: string, kind: DriftItem<unknown>['kind'], extra: Partial<DriftItem<unknown>> = {}): DriftItem<unknown> => ({ id, label: id, kind, noun: 'thing', ...extra });
const view = (items: DriftItem<unknown>[], extra: Partial<Drift<unknown>> = {}) => ({
  drift: { plan: { title: 'Teams', savedAt }, items, unexplained: items.filter((i) => !i.cause).length, strayReasons: [], ...extra },
  now,
});
const room = { width: 80, color: false };

describe('driftBlock', () => {
  it('is empty without a plan', () => {
    expect(driftBlock(undefined, room)).toBe('');
  });

  it('says so when the build matches the plan', () => {
    expect(driftBlock(view([]), room)).toBe('built as planned ✓ (plan "Teams")');
  });

  it('lists each drift with its marker, kind, detail and reason', () => {
    const out = driftBlock(
      view([
        item('memberships', 'missing', { cause: 'bug-found', why: 'lock was needed' }),
        item('audit', 'unplanned', { cause: 'user-asked', why: 'asked for it' }),
        item('orders', 'different', { detail: 'path a → b', cause: 'cleaner-way', why: 'moved' }),
        item('legacy', 'missing'),
      ]),
      room,
    );
    expect(out).toBe(
      [
        'Plan vs built (plan "Teams", drawn 2h ago)',
        '− memberships  in the plan, not built · why: found a bug',
        '    “lock was needed”',
        '+ audit  built, not in the plan · why: you asked for it',
        '    “asked for it”',
        '~ orders  built differently (path a → b) · why: found a cleaner way',
        '    “moved”',
        '✗ legacy  in the plan, not built · no reason given',
      ].join('\n'),
    );
  });

  it('shows five, then how many more and where to see them', () => {
    const items = Array.from({ length: 7 }, (_, i) => item(`n${i}`, 'unplanned', { cause: 'other', why: 'x' }));
    expect(driftBlock(view(items), room).split('\n').slice(-3)).toEqual(['+ n4  built, not in the plan · why: other', '    “x”', '2 more not shown']);
    expect(driftBlock(view(items), { ...room, htmlPath: '/tmp/x.html' }).split('\n').at(-1)).toBe('2 more → full map');
  });

  it('warns about reasons for things that did not drift', () => {
    expect(driftBlock(view([], { strayReasons: ['ghost', 'x'] }), room)).toBe('built as planned ✓ (plan "Teams")\n⚠ reasons without drift: ghost · x');
  });

  it('wraps and cuts to the width, and strips control characters', () => {
    const long = item('a', 'different', { label: 'a\u001b[31mlabel', detail: 'x'.repeat(60), cause: 'other', why: 'y'.repeat(60) });
    const out = driftBlock(view([long]), { width: 40, color: false });
    expect(out).not.toContain('\u001b');
    for (const line of out.split('\n')) expect(columns(line)).toBeLessThanOrEqual(40);
  });

  it('paints the item, not the reason, when colour is on', () => {
    const out = driftBlock(view([item('a', 'missing', { cause: 'other', why: 'x' })]), { width: 80, color: true });
    expect(out).toContain('\u001b[31ma  in the plan, not built\u001b[0m · why: other');
  });
});

describe('ageText', () => {
  it.each([
    [0, 'just now'],
    [5 * 60_000, '5m ago'],
    [3 * 3_600_000, '3h ago'],
    [72 * 3_600_000, '3d ago'],
  ])('%i ms -> %s', (ms, text) => {
    expect(ageText(new Date(now.getTime() - ms).toISOString(), now)).toBe(text);
  });
});
