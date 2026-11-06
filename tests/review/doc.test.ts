import { describe, expect, it } from 'vitest';
import { buildDoc } from '../../src/review/doc.js';
import { countsLine, feedbackText, osc52 } from '../../src/review/feedback.js';
import { parseDoc } from '../../src/review/parse.js';
import { api, note, review } from './fixture.js';

const now = new Date('2026-10-28T09:10:00.000Z');
const anchor = (side: 'old' | 'new', line: number, text: string) => ({ path: api.path!, side, line, text });

/** Inserts `add` lines right after the first doc line that contains `after`. */
function edit(doc: string, after: string, ...add: string[]): string {
  const lines = doc.split('\n');
  lines.splice(lines.findIndex((l) => l.includes(after)) + 1, 0, ...add);
  return lines.join('\n');
}

describe('buildDoc', () => {
  it('header, instructions, a header per node, hunks and diff rows with sign and line number', () => {
    const doc = buildDoc(review());
    const [title, ...rest] = doc.split('\n');
    expect(title).toMatch(/^# Review: Invites by email · branch feat\/invites · drawn at \d\d:\d\d$/);
    expect(rest.slice(0, 3).every((l) => l.startsWith('# '))).toBe(true);
    expect(doc).toContain('## invites route — src/routes/invites.ts  [api]\n@@ -10,3 +10,4 @@ router\n  10  router.post');
    expect(doc).toContain('\n- 11    const email = req.body.email\n+ 11    const { email, teamId } = req.body\n+ 12');
    expect(doc).toContain('## mailer — src/mail/invite.ts  [mailer]\n# generated file, not shown\n');
    expect(doc).toContain('# Unchanged on the map (you can still note on them):\n## queue  [queue]\n');
  });

  it('changed nodes come first in map order, unchanged ones follow in one section without empty blocks', () => {
    const nodes = [{ id: 'q', label: 'queue' }, { ...api }, { id: 'c', label: 'cache', path: 'src/cache.ts' }];
    const doc = buildDoc(review([], nodes));
    expect(doc.indexOf('[api]')).toBeLessThan(doc.indexOf('# Unchanged on the map'));
    expect(doc).toMatch(/# Unchanged on the map \(you can still note on them\):\n## queue {2}\[q\]\n## cache — src\/cache.ts {2}\[c\]\n$/);
    expect(doc).not.toContain('## queue  [q]\n\n');
  });

  it('a second node on the same file and diff points back instead of repeating the hunks', () => {
    const twin = { ...api, id: 'api2', label: 'invites model' };
    const doc = buildDoc(review([note('n1', { node: 'api2', body: 'same here', anchor: undefined })], [api, twin]));
    expect(doc.split('@@ -10,3 +10,4 @@').length).toBe(2);
    expect(doc).toContain('## invites model — src/routes/invites.ts  [api2]\n# Same diff as "invites route" above.\n> same here\n');
  });

  it('an older review file without a title falls back to the slug; no branch is left out', () => {
    const r = review();
    const doc = buildDoc({ ...r, change: { ...r.change, title: undefined, branch: '' } });
    expect(doc.split('\n')[0]).toMatch(/^# Review: invites · drawn at \d\d:\d\d$/);
  });

  it('pending notes sit in place; sent and outdated ones are comments; notes of gone nodes go last', () => {
    const doc = buildDoc(
      review([
        note('n1', { node: 'queue', rev: undefined, body: 'whole node' }),
        note('n2', { kind: 'question', body: 'why?', anchor: anchor('new', 11, 'x') }),
        note('n3', { kind: 'delete', body: 'drop it', anchor: anchor('old', 11, 'x') }),
        note('n4', { state: 'sent', body: 'old news' }),
        note('n5', { state: 'outdated', node: 'zzz', body: 'lost' }),
      ]),
    );
    expect(doc).toContain('## queue  [queue]\n> whole node\n');
    expect(doc).toContain('+ 11    const { email, teamId } = req.body\n>? why?\n');
    expect(doc).toContain('- 11    const email = req.body.email\n>del drop it\n');
    expect(doc).toContain('## invites route — src/routes/invites.ts  [api]\n# Already sent to your agent (comment): old news\n@@');
    expect(doc).toMatch(/# Notes on nodes the map no longer has:\n# Outdated \(comment\) on \[zzz\]: lost\n$/);
  });
});

describe('a node on the same diff as an earlier one', () => {
  const twin = { ...api, id: 'api2', label: 'invites model' };

  it('with a note on one of its lines prints its rows, so the anchor survives a save', () => {
    const notes = [note('n1', { node: 'api2', body: 'check', anchor: anchor('new', 12, '  await invite(email, teamId)') })];
    const r = review(notes, [api, twin]);
    const doc = buildDoc(r);
    expect(doc).not.toContain('# Same diff as');
    expect(doc.split('@@ -10,3 +10,4 @@').length).toBe(3);
    expect(parseDoc(doc, r, new Date()).notes).toEqual(notes);
  });

  it('with only node-level notes still points back', () => {
    const doc = buildDoc(review([note('n1', { node: 'api2', body: 'whole' })], [api, twin]));
    expect(doc).toContain('# Same diff as "invites route" above.\n> whole');
  });
});

describe('labels and paths with line breaks', () => {
  const odd = { id: 'odd', label: 'two\nlines', path: 'dir/na\tme.ts', rev: 'r' };

  it('stay on one heading line, which the parser still reads', () => {
    const r = review([], [odd]);
    const doc = buildDoc(r);
    expect(doc).toContain('## two lines — dir/na me.ts  [odd]\n');
    const { notes, warnings } = parseDoc(edit(doc, '[odd]', '> still found'), r, new Date());
    expect(warnings).toEqual([]);
    expect(notes).toEqual([expect.objectContaining({ node: 'odd', body: 'still found' })]);
  });

  it('and in feedback items and the same-diff line', () => {
    const r = review([note('n1', { node: 'odd', body: 'x', rev: 'r' })], [odd]);
    expect(feedbackText(r)).toContain('1. two lines (dir/na me.ts)  [odd]\n');
    const t = { ...api, id: 'a', label: 'x\ny' };
    expect(buildDoc(review([], [t, { ...t, id: 'b', label: 'z' }]))).toContain('# Same diff as "x y" above.');
  });
});

describe('parseDoc', () => {
  const base = buildDoc(review());

  it('round trip: a doc built from notes parses back to the same notes, in document order', () => {
    const notes = [
      note('n1', { node: 'queue', rev: undefined, body: 'whole node' }),
      note('n2', { kind: 'question', body: 'why?', anchor: anchor('new', 11, '  const { email, teamId } = req.body') }),
      note('n3', { kind: 'delete', body: 'drop it', anchor: anchor('old', 11, '  const email = req.body.email') }),
    ];
    const r = review(notes);
    expect(parseDoc(buildDoc(r), r, now)).toEqual({ notes: [notes[2], notes[1], notes[0]], warnings: [] });
  });

  it('kinds: > comment, >? question, >del delete; body trimmed', () => {
    const doc = edit(base, '[mailer]', '>   plain  ', '>? what for', '>del remove', '> del not a delete', '>delete is a comment');
    const { notes } = parseDoc(doc, review(), now);
    expect(notes.map((n) => [n.kind, n.body])).toEqual([
      ['comment', 'plain'],
      ['question', 'what for'],
      ['delete', 'remove'],
      ['comment', 'del not a delete'],
      ['comment', 'delete is a comment'],
    ]);
  });

  it('anchor: the nearest diff line above, new side for add/ctx, old side for del', () => {
    const doc = edit(edit(edit(base, '+ 12', '> on added'), '- 11', '> on deleted'), '  10  router', '> on context');
    const { notes } = parseDoc(doc, review(), now);
    expect(notes.map((n) => n.anchor)).toEqual([
      anchor('new', 10, 'router.post("/invites", async (req) => {'),
      anchor('old', 11, '  const email = req.body.email'),
      anchor('new', 12, '  await invite(email, teamId)'),
    ]);
  });

  it('the old heading form, ## [id] label, still names its node', () => {
    const doc = base.replace('## queue  [queue]', '## [queue] queue');
    expect(parseDoc(edit(doc, '[queue] queue', '> ok'), review(), now).notes[0]).toMatchObject({ node: 'queue', body: 'ok' });
  });

  it('under a node header or a hunk header the note is node-level; a second note shares the anchor', () => {
    const doc = edit(edit(edit(base, '[api]', '> a'), '@@ -10', '> b'), '+ 11    const {', '> c', '', '# skip', '> d');
    const { notes } = parseDoc(doc, review(), now);
    expect(notes.map((n) => [n.body, n.anchor?.line])).toEqual([['a', undefined], ['b', undefined], ['c', 11], ['d', 11]]);
    expect(notes.every((n) => n.node === 'api' && n.rev === 'rev-api')).toBe(true);
  });

  it('a note under a node with no rev or lines carries neither rev nor anchor', () => {
    const { notes } = parseDoc(edit(base, '[queue]', '> q'), review(), now);
    expect(notes).toEqual([expect.objectContaining({ node: 'queue', body: 'q' })]);
    expect(notes[0]).not.toHaveProperty('rev');
    expect(notes[0]).not.toHaveProperty('anchor');
  });

  it('empty bodies and # lines are ignored', () => {
    const { notes, warnings } = parseDoc(edit(base, '[api]', '>', '>?  ', '>del', '# > text'), review(), now);
    expect(notes).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('a note before any node, or under an unknown header, is dropped with a warning', () => {
    const doc = `> early\n${edit(base, '[queue]', '> ok')}\n## [ghost] gone\n> lost\n`;
    const { notes, warnings } = parseDoc(doc, review(), now);
    expect(notes.map((n) => n.body)).toEqual(['ok']);
    expect(warnings).toEqual([
      "Line 1: this note isn't under a node, so it was skipped",
      expect.stringMatching(/^Line \d+: unknown node heading, so its notes were skipped$/),
      expect.stringMatching(/^Line \d+: this note isn't under a node/),
    ]);
  });

  it('editing existing pending notes: unchanged keep id and time, edited get a fresh id, deleted vanish', () => {
    const keep = note('n1', { node: 'queue', rev: undefined, body: 'keep' });
    const edited = note('n2', { node: 'queue', rev: undefined, body: 'before' });
    const gone = note('n3', { node: 'queue', rev: undefined, body: 'gone' });
    const r = review([keep, edited, gone]);
    const doc = buildDoc(r).replace('> before', '> after').replace('> gone\n', '');
    const { notes } = parseDoc(doc, r, now);
    expect(notes).toEqual([keep, expect.objectContaining({ id: 'n4', body: 'after', at: now.toISOString() })]);
  });

  it('sent and outdated comments are not read back', () => {
    const r = review([note('n1', { state: 'sent' }), note('n2', { state: 'outdated' })]);
    expect(parseDoc(buildDoc(r), r, now).notes).toEqual([]);
  });
});

describe('feedback text', () => {
  const r = review([
    note('n1', { body: 'no validation on email', anchor: anchor('new', 13, 'const { email, teamId } = req.body') }),
    note('n2', { node: 'mailer', kind: 'question', body: 'queue it?\nor inline?' }),
    note('n3', { node: 'queue', kind: 'delete', body: 'unused' }),
    note('n4', { state: 'sent' }),
  ]);

  it('numbers pending notes with node, path, line and side, quote and kind', () => {
    expect(feedbackText(r)).toBe(
      [
        '# Review feedback: Invites by email (3 notes)',
        '',
        '1. invites route (src/routes/invites.ts:13, new line)  [api]',
        '   > const { email, teamId } = req.body',
        '   Comment: no validation on email',
        '',
        '2. mailer (src/mail/invite.ts)  [mailer]',
        '   Question: queue it?',
        '   or inline?',
        '',
        '3. queue  [queue]',
        '   Delete: unused',
        '',
      ].join('\n'),
    );
  });

  it('none pending -> undefined', () => {
    expect(feedbackText(review([note('n1', { state: 'sent' })]))).toBeUndefined();
  });

  it('counts line and OSC 52', () => {
    expect(countsLine(r)).toBe('3 notes saved — 1 comment · 1 question · 1 delete');
    expect(osc52('hi')).toBe('\x1b]52;c;aGk=\x07');
  });
});
