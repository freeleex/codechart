import { describe, expect, it } from 'vitest';
import { buildDoc } from '../../src/review/doc.js';
import { feedbackText } from '../../src/review/feedback.js';
import { mergeNotes } from '../../src/review/merge.js';
import { parseDoc } from '../../src/review/parse.js';
import type { Note } from '../../src/review/schema.js';
import { note, review } from './fixture.js';

const on = (id: string, target: Note['target'], body: string, over: Partial<Note> = {}): Note => note(id, { node: undefined, rev: undefined, target, body, ...over });
const withLists = (notes: Note[]) => ({
  ...review(notes),
  drift: [{ id: 'queue', kind: 'missing' as const, label: 'job queue' }, { id: 'api', kind: 'different' as const, label: 'invites route' }],
});
const text = (...notes: Note[]) => feedbackText(withLists(notes))!;

describe('feedbackText for notes on more than nodes', () => {
  it('names the plan-vs-built item in plain words', () => {
    expect(text(on('n1', { type: 'drift', id: 'queue', kind: 'missing' }, 'build it'), on('n2', { type: 'drift', id: 'api', kind: 'unplanned' }, 'why', { kind: 'question' }), on('n3', { type: 'drift', id: 'api', kind: 'different' }, 'drop', { kind: 'delete' }))).toBe(
      [
        '# Review feedback: Invites by email (3 notes)',
        '',
        '1. On the plan-vs-built note of job queue (not built)',
        '   Comment: build it',
        '',
        '2. On the plan-vs-built note of invites route (built, not in the plan)',
        '   Question: why',
        '',
        '3. On the plan-vs-built note of invites route (built differently)',
        '   Delete: drop',
        '',
      ].join('\n'),
    );
  });

  it('arrows with node labels and the arrow label, gaps, not-on-map items, the title', () => {
    expect(text(on('n1', { type: 'edge', from: 'api', to: 'mailer', label: 'sends' }, 'a'), on('n2', { type: 'edge', from: 'api', to: 'unknown' }, 'b'), on('n3', { type: 'gap', text: 'no tests' }, 'c'), on('n4', { type: 'omitted', text: 'cron job' }, 'd'), on('n5', { type: 'title' }, 'e\nf'))).toBe(
      [
        '# Review feedback: Invites by email (5 notes)',
        '',
        '1. On the arrow invites route → mailer (“sends”)',
        '   Comment: a',
        '',
        '2. On the arrow invites route → unknown',
        '   Comment: b',
        '',
        '3. On the gap “no tests”',
        '   Comment: c',
        '',
        '4. On the not-on-map item “cron job”',
        '   Comment: d',
        '',
        '5. On the title',
        '   Comment: e',
        '   f',
        '',
      ].join('\n'),
    );
  });

  it('a note on a node keeps the old format, and only pending notes print', () => {
    expect(text(note('n1'), on('n2', { type: 'title' }, 'sent', { state: 'sent' }))).toContain('1. invites route (src/routes/invites.ts)  [api]\n   Comment: check this');
    expect(feedbackText(review([on('n1', { type: 'title' }, 'x', { state: 'outdated' })]))).toBeUndefined();
  });

  it('strips what could drive a terminal from labels', () => {
    expect(text(on('n1', { type: 'gap', text: 'a\x1b[2Jb\nc' }, 'x'))).toContain('On the gap “a[2Jb c”');
  });
});

describe('the editor and notes with a target', () => {
  const targeted = (): Note[] => [on('n1', { type: 'drift', id: 'api', kind: 'different' }, 'drift note', { node: 'api' }), on('n2', { type: 'title' }, 'title note')];

  it('the document does not list them, and parsing it keeps them out of the notes', () => {
    const r = withLists([...targeted(), note('n3')]);
    const doc = buildDoc(r);
    expect(doc).not.toContain('drift note');
    expect(doc).not.toContain('title note');
    const parsed = parseDoc(doc, r, new Date());
    expect(parsed.notes.map((n) => n.id)).toEqual(['n3']);
  });

  it('merging an editor save never loses them', () => {
    const r = withLists([...targeted(), note('n3')]);
    const parsed = parseDoc(buildDoc(r), r, new Date());
    const merged = mergeNotes(r, parsed.notes, r);
    expect(merged.map((n) => n.id).sort()).toEqual(['n1', 'n2', 'n3']);
    expect(merged.find((n) => n.id === 'n1')).toEqual(targeted()[0]);
    expect(mergeNotes(r, [], r).map((n) => n.id).sort()).toEqual(['n1', 'n2']);
  });
});
