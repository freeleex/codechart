import { describe, expect, it } from 'vitest';
import { carryNotes } from '../../src/review/carry.js';
import type { Lists } from '../../src/review/carry.js';
import type { Note } from '../../src/review/schema.js';
import { api, mailer, note, review } from './fixture.js';

describe('carryNotes', () => {
  it('same node id and rev -> note kept as it is', () => {
    const n = note('n1', { anchor: { path: api.path!, side: 'new', line: 11, text: 'x' } });
    expect(carryNotes(review([n]), [api, mailer])).toEqual([n]);
  });

  it('same node id, diff changed -> pending note outdated, anchor kept', () => {
    const n = note('n1', { anchor: { path: api.path!, side: 'new', line: 11, text: 'x' } });
    const [out] = carryNotes(review([n]), [{ ...api, rev: 'other' }, mailer]);
    expect(out).toEqual({ ...n, state: 'outdated' });
  });

  it('node id gone, same path with same rev -> note follows the path to the new id', () => {
    const [out] = carryNotes(review([note('n1')]), [{ ...api, id: 'api2' }, mailer]);
    expect(out).toMatchObject({ node: 'api2', state: 'pending' });
  });

  it('node id gone, same path with another rev -> outdated on the new id', () => {
    const [out] = carryNotes(review([note('n1')]), [{ ...api, id: 'api2', rev: 'other' }]);
    expect(out).toMatchObject({ node: 'api2', state: 'outdated' });
  });

  it('no node matches -> outdated, node id untouched', () => {
    const [out] = carryNotes(review([note('n1')]), [mailer]);
    expect(out).toMatchObject({ node: 'api', state: 'outdated' });
  });

  it('a node without a path and a new id matches nothing', () => {
    const [out] = carryNotes(review([note('n1', { node: 'queue', rev: undefined })]), [{ id: 'q2', label: 'queue' }]);
    expect(out).toMatchObject({ node: 'queue', state: 'outdated' });
  });

  it('sent notes stay sent, even when the diff changed or the node is gone', () => {
    const sent = note('n1', { state: 'sent' });
    expect(carryNotes(review([sent]), [{ ...api, rev: 'other' }])[0]).toEqual(sent);
    expect(carryNotes(review([sent]), [mailer])[0]).toEqual(sent);
  });

  it('outdated notes stay outdated', () => {
    const [out] = carryNotes(review([note('n1', { state: 'outdated' })]), [api]);
    expect(out!.state).toBe('outdated');
  });

  describe('notes on the plan-vs-built, arrows, gaps and the title', () => {
    const lists: Lists = { drift: [{ id: 'api', kind: 'different', label: 'x' }], edges: [{ from: 'api', to: 'mailer', label: 'sends' }], gaps: ['no tests'], omitted: ['cron'] };
    const on = (target: Note['target'], over: Partial<Note> = {}) => note('n1', { node: undefined, rev: undefined, target, ...over });
    const out = (n: Note, l: Lists = lists) => carryNotes(review([n]), [api, mailer], l)[0]!;

    it('drift: kept with the same id and kind, else outdated', () => {
      expect(out(on({ type: 'drift', id: 'api', kind: 'different' })).state).toBe('pending');
      expect(out(on({ type: 'drift', id: 'api', kind: 'missing' })).state).toBe('outdated');
      expect(out(on({ type: 'drift', id: 'zzz', kind: 'different' })).state).toBe('outdated');
    });

    it('arrow: kept with the same ends and label', () => {
      expect(out(on({ type: 'edge', from: 'api', to: 'mailer', label: 'sends' }), lists).state).toBe('pending');
      expect(out(on({ type: 'edge', from: 'api', to: 'mailer' })).state).toBe('outdated');
      expect(out(on({ type: 'edge', from: 'api', to: 'mailer', label: 'sends' }), { ...lists, edges: [] }).state).toBe('outdated');
    });

    it('gap and not-on-map item: kept with the exact text', () => {
      expect(out(on({ type: 'gap', text: 'no tests' })).state).toBe('pending');
      expect(out(on({ type: 'gap', text: 'no test' })).state).toBe('outdated');
      expect(out(on({ type: 'omitted', text: 'cron' })).state).toBe('pending');
      expect(out(on({ type: 'omitted', text: 'cron' }), {}).state).toBe('outdated');
    });

    it('title: always kept', () => {
      expect(out(on({ type: 'title' }), {}).state).toBe('pending');
    });

    it('sent notes never change state', () => {
      for (const target of [{ type: 'gap', text: 'gone' }, { type: 'drift', id: 'zzz', kind: 'missing' }] as const) {
        const sent = on(target, { state: 'sent' });
        expect(out(sent)).toEqual(sent);
      }
    });
  });
});
