import { describe, expect, it } from 'vitest';
import { carryNotes } from '../../src/review/carry.js';
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
});
