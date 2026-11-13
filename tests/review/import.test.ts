import { describe, expect, it } from 'vitest';
import { placeText } from '../../src/render/web/browser/targets.js';
import { importNotes, parseReviewText, type ImportPayload } from '../../src/review/import.js';
import type { Review } from '../../src/review/schema.js';
import { api, note, review } from './fixture.js';

const payload = (notes: ImportPayload['notes'] = [{ t: { node: 'api' }, r: 'rev-api', k: 'comment', b: 'check this' }]): ImportPayload => ({ v: 1, slug: 'invites', branch: 'feat/invites', at: '2026-10-28T08:05:03.000Z', notes });
const LABEL = { comment: 'Comment', question: 'Question', delete: 'Delete' };
type Words = { t?: unknown; r?: string; k: keyof typeof LABEL; b: string };
const notesOf = (p: unknown): Words[] => (p as { notes?: Words[] }).notes ?? [];
const token = (p: unknown): string => Buffer.from(JSON.stringify({ ...(p as object), ...(typeof p === 'object' && 'notes' in (p as object) && { notes: notesOf(p).map(({ t, r, k }) => ({ t, r, k })) }) })).toString('base64url');
const items = (p: unknown = payload()): string => notesOf(p).map((n, i) => `${i + 1}. On somewhere: ${LABEL[n.k]}: ${n.b.replace(/\n/g, '\n   ')}`).join('\n');
const pasted = (p: unknown = payload()): string => `Review done: ${notesOf(p).length} notes.\n${items(p)}\n\ncodechart review · ${notesOf(p).length} notes · ${token(p)}\n`;
const DAMAGED = 'The codechart review is damaged; copy it again with "Finish review" on the page.';
const MISMATCH = 'The review text doesn\'t match its last line; copy it again with "Finish review" on the page.';
const now = new Date('2026-10-29T10:00:00.000Z');

describe('parseReviewText', () => {
  it('reads the token after the closing line', () => {
    expect(parseReviewText(pasted())).toEqual(payload());
  });

  it('survives a token wrapped over lines, with spaces and CRLF', () => {
    const t = token(payload());
    const wrapped = `${items()}\n\ncodechart review · 1 note · ${t.slice(0, 20)}\r\n${t.slice(20, 50)} \r\n  ${t.slice(50)}`;
    expect(parseReviewText(wrapped)).toEqual(payload());
  });

  it('survives quote marks and a code fence', () => {
    const t = token(payload());
    expect(parseReviewText(`> ${items()}\n>\n> codechart review · 1 note · ${t.slice(0, 30)}\n> ${t.slice(30)}`)).toEqual(payload());
    expect(parseReviewText(`\`\`\`\n${items()}\n\n  codechart review · 1 note · ${t}\n\`\`\`\n`)).toEqual(payload());
  });

  it('the last closing line wins', () => {
    const first = payload([{ t: { title: true }, k: 'comment', b: 'old' }]);
    expect(parseReviewText(`${pasted(first)}\nand again\n${pasted()}`)).toEqual(payload());
  });

  it('no closing line', () => {
    for (const text of ['', 'just a chat message', 'codechart review is great']) expect(() => parseReviewText(text)).toThrow('No codechart review found. Copy it again with "Finish review" on the page.');
  });

  it('a damaged token', () => {
    const t = token(payload());
    for (const bad of ['codechart review · 1 note ·', `codechart review · 1 note · ${t.slice(0, -8)}`, 'codechart review · 1 note · !!!!', `codechart review · 1 note · ${token('x').slice(0, 3)}`]) {
      expect(() => parseReviewText(`${items()}\n\n${bad}`), bad).toThrow(DAMAGED);
    }
  });

  it('JSON that is not a review', () => {
    for (const p of [{}, { ...payload(), v: 2 }, { ...payload(), extra: 1 }, payload([{ t: { node: 'a', extra: 1 }, k: 'comment', b: 'x' } as never]), payload([{ t: { node: 'a' }, k: 'shout', b: 'x' } as never]), payload([{ t: { node: 'a', path: 'p', side: 'new', line: 0 }, k: 'comment', b: 'x' }])]) {
      expect(() => parseReviewText(pasted(p))).toThrow(DAMAGED);
    }
  });

  it('every target shape is accepted', () => {
    const targets: ImportPayload['notes'][number]['t'][] = [
      { node: 'a' },
      { node: 'a', path: 'p.ts', side: 'old', line: 3 },
      { drift: 'a', kind: 'missing' },
      { edge: { from: 'a', to: 'b', label: 'calls' } },
      { gap: 'no tests' },
      { omitted: 'cron' },
      { title: true },
    ];
    expect(parseReviewText(pasted(payload(targets.map((t) => ({ t, k: 'question' as const, b: 'x' })))))!.notes.map((n) => n.t)).toEqual(targets);
  });

  it('caps: 500 notes, 4000 chars a body, 2000 a string, 512 KB of input', () => {
    const one = (b: string) => ({ t: { title: true as const }, k: 'comment' as const, b });
    expect(parseReviewText(pasted(payload(Array.from({ length: 500 }, () => one('x'))))).notes).toHaveLength(500);
    expect(() => parseReviewText(pasted(payload(Array.from({ length: 501 }, () => one('x')))))).toThrow(DAMAGED);
    expect(parseReviewText(pasted(payload([one('x'.repeat(4000))]))).notes).toHaveLength(1);
    expect(() => parseReviewText(pasted(payload([one('x'.repeat(4001))])))).toThrow(DAMAGED);
    expect(() => parseReviewText(pasted({ ...payload(), slug: 'x'.repeat(2001) }))).toThrow(DAMAGED);
    expect(() => parseReviewText(`${'x'.repeat(512 * 1024)}\n${pasted()}`)).toThrow('too long');
  });

  it('the token is small: no bodies in it', () => {
    const long = (b: string) => ({ t: { node: 'api', path: 'src/a.ts', side: 'new' as const, line: 3 }, r: 'rev-api', k: 'comment' as const, b });
    const text = pasted(payload([long('x'.repeat(3000)), long('y'.repeat(3000))]));
    expect(text.split(' · ').at(-1)!.trim().length).toBeLessThan(400);
    expect(parseReviewText(text).notes.map((n) => n.b.length)).toEqual([3000, 3000]);
  });

  it('bodies come from the numbered lines: first mark only, continuation lines, quotes, CRLF', () => {
    const p = payload([
      { t: { gap: 'a: Comment: b' }, k: 'comment', b: 'one: Comment: two\nsecond\n\nfourth' },
      { t: { title: true }, k: 'delete', b: '  3. not an item  ' },
    ]);
    const crlf = pasted(p).replace(/\n/g, '\r\n');
    const quoted = pasted(p).split('\n').map((l) => `> ${l}  `).join('\n');
    for (const text of [pasted(p), crlf, quoted]) expect(parseReviewText(text).notes.map((n) => n.b)).toEqual(['one: Comment: two\nsecond\n\nfourth', '3. not an item']);
  });

  it('place text from the page never swallows the note: a gap with ": Comment: " in it', () => {
    const t = { gap: 'Retries: Comment: none yet' };
    const p = payload([{ t, k: 'comment', b: 'add a test' }]);
    const text = `1. On ${placeText(t)}: Comment: add a test\n\ncodechart review · 1 note · ${token(p)}`;
    expect(parseReviewText(text).notes.map((n) => n.b)).toEqual(['add a test']);
  });

  it("a note's own > lines are kept; only the quote every line shares, the closing line too, is taken off", () => {
    const b = 'this line:\n> return null\nis wrong';
    const p = payload([{ t: { title: true }, k: 'comment', b }]);
    const quoted = (prefix: string) => pasted(p).split('\n').map((l) => `${prefix}${l}`).join('\n');
    for (const text of [pasted(p), quoted('> '), quoted('>'), quoted('> > ')]) expect(parseReviewText(text).notes[0]!.b, text).toBe(b);
  });

  it('a flow gap led by its flow title fits: up to 2202 characters', () => {
    const gap = (n: number) => payload([{ t: { gap: `Checkout: ${'x'.repeat(n - 10)}` }, k: 'comment', b: 'hm' }]);
    expect(parseReviewText(pasted(gap(2100))).notes).toHaveLength(1);
    expect(parseReviewText(pasted(gap(2202))).notes).toHaveLength(1);
    expect(() => parseReviewText(pasted(gap(2203)))).toThrow(DAMAGED);
  });

  it('text that does not match the token is refused in plain words', () => {
    const two = payload([{ t: { title: true }, k: 'comment', b: 'a' }, { t: { title: true }, k: 'question', b: 'b' }]);
    const body = (text: string) => `${text}\n\ncodechart review · 2 notes · ${token(two)}`;
    const bad = {
      'no items': body(''),
      'item missing': body('1. On the title: Comment: a'),
      'extra item': body(`${items(two)}\n3. On the title: Comment: c`),
      'out of order': body('2. On the title: Question: b\n1. On the title: Comment: a'),
      'other kind': body('1. On the title: Comment: a\n2. On the title: Delete: b'),
      'empty body': body('1. On the title: Comment: a\n2. On the title: Question:  '),
    };
    for (const [name, text] of Object.entries(bad)) expect(() => parseReviewText(text), name).toThrow(MISMATCH);
  });
});

const target = (t: ImportPayload['notes'][number]['t'], body = 'hm', r?: string): ImportPayload['notes'] => [{ t, ...(r && { r }), k: 'comment', b: body }];
const withLists = (): Review => ({
  ...review(),
  drift: [{ id: 'api', kind: 'different', label: 'invites route' }, { id: 'ghost', kind: 'missing', label: 'queue worker' }],
  edges: [{ from: 'api', to: 'mailer', label: 'sends' }],
  gaps: ['no tests'],
  omitted: ['cron job'],
});
const added = (r: Review, p: ImportPayload['notes']) => importNotes(r, payload(p), now);

describe('importNotes', () => {
  it('a node note: next id, kind, body, rev, time; pending when the rev is the same', () => {
    const out = added(review([note('n4', { body: 'other' })]), target({ node: 'api' }, 'check this', 'rev-api'));
    expect(out).toMatchObject({ added: 1, outdated: 0 });
    expect(out.review.notes.at(-1)).toEqual({ id: 'n5', node: 'api', rev: 'rev-api', kind: 'comment', body: 'check this', state: 'pending', at: now.toISOString() });
  });

  it('a node note is outdated when the rev changed or the node is gone', () => {
    expect(added(review(), target({ node: 'api' }, 'x', 'old')).review.notes[0]).toMatchObject({ state: 'outdated', rev: 'old' });
    const gone = added(review(), target({ node: 'zzz' }, 'x', 'r'));
    expect(gone.review.notes[0]).toMatchObject({ node: 'zzz', state: 'outdated' });
    expect(gone.outdated).toBe(1);
  });

  it('text in a target never reaches the review with terminal control or invisible characters', () => {
    const bad = (s: string) => `${s}\u001b]52;c;x\u0007‮`;
    const notes = added(review(), [
      { t: { node: bad('zzz') }, r: 'r', k: 'comment', b: 'a' },
      { t: { node: bad('zzz'), path: bad('p.ts'), side: 'new', line: 1 }, r: 'r', k: 'comment', b: 'b' },
      { t: { drift: bad('zzz'), kind: 'missing' }, k: 'comment', b: 'c' },
      { t: { edge: { from: bad('a'), to: bad('b'), label: bad('l') } }, k: 'comment', b: 'd' },
      { t: { gap: bad('g') }, k: 'comment', b: 'e' },
      { t: { omitted: bad('o') }, k: 'comment', b: 'f' },
    ]).review.notes;
    expect(JSON.stringify(notes)).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‮]/);
  });

  it('a gap, omitted item, arrow label or node id with invisible characters matches the sanitized snapshot', () => {
    const z = 'no​ tests‪';
    const out = added(withLists(), [
      { t: { gap: z }, k: 'comment', b: 'a' },
      { t: { omitted: 'cron​ job' }, k: 'comment', b: 'b' },
    ]);
    expect(out.review.notes.map((n) => n.state)).toEqual(['pending', 'pending']);
  });

  it('a line note gets the anchor from the diff the file holds', () => {
    const [n] = added(review(), target({ node: 'api', path: 'src/routes/invites.ts', side: 'old', line: 11 }, 'why', 'rev-api')).review.notes;
    expect(n).toMatchObject({ state: 'pending', anchor: { path: api.path, side: 'old', line: 11, text: '  const email = req.body.email' } });
  });

  it('a line note on a line the diff lacks is outdated with an empty anchor text', () => {
    const [n] = added(review(), target({ node: 'api', path: 'src/routes/invites.ts', side: 'new', line: 99 }, 'why', 'rev-api')).review.notes;
    expect(n).toMatchObject({ state: 'outdated', anchor: { line: 99, side: 'new', text: '' } });
  });

  it('a drift note: pending while the item is in the file, with the node when it is one', () => {
    const [n, g, x] = added(withLists(), [
      ...target({ drift: 'api', kind: 'different' }),
      ...target({ drift: 'ghost', kind: 'missing' }),
      ...target({ drift: 'api', kind: 'missing' }),
    ]).review.notes;
    expect(n).toMatchObject({ node: 'api', target: { type: 'drift', id: 'api', kind: 'different' }, state: 'pending' });
    expect(g!.node).toBeUndefined();
    expect(g!.state).toBe('pending');
    expect(x!.state).toBe('outdated');
  });

  it('an arrow note has the node from, and is outdated when the arrow or its label differs', () => {
    const [ok, noLabel, other] = added(withLists(), [
      ...target({ edge: { from: 'api', to: 'mailer', label: 'sends' } }),
      ...target({ edge: { from: 'api', to: 'mailer' } }),
      ...target({ edge: { from: 'mailer', to: 'api' } }),
    ]).review.notes;
    expect(ok).toMatchObject({ node: 'api', target: { type: 'edge', from: 'api', to: 'mailer', label: 'sends' }, state: 'pending' });
    expect([noLabel!.state, other!.state]).toEqual(['outdated', 'outdated']);
  });

  it('gap and not-on-map notes need the exact text; the title is always pending', () => {
    const out = added(withLists(), [
      ...target({ gap: 'no tests' }),
      ...target({ gap: 'no test' }),
      ...target({ omitted: 'cron job' }),
      ...target({ omitted: 'other' }),
      ...target({ title: true }),
    ]);
    expect(out.review.notes.map((n) => n.state)).toEqual(['pending', 'outdated', 'pending', 'outdated', 'pending']);
    expect(out.review.notes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
    expect(out).toMatchObject({ added: 5, outdated: 2 });
  });

  it('a note equal to one saved, in any state, is not added again', () => {
    const p = [...target({ node: 'api' }, 'check this', 'rev-api'), ...target({ gap: 'no tests' }, 'x'), ...target({ title: true }, 'x')];
    const once = added(withLists(), p);
    expect(once.added).toBe(3);
    const sent = { ...once.review, notes: once.review.notes.map((n) => ({ ...n, state: 'sent' as const })) };
    const twice = added(sent, p);
    expect(twice).toMatchObject({ added: 0, outdated: 0 });
    expect(twice.review).toBe(sent);
    expect(added(once.review, target({ gap: 'no tests' }, 'another body')).added).toBe(1);
    expect(added(once.review, target({ omitted: 'no tests' }, 'x')).added).toBe(1);
  });

  it('the same words on a newer rev are a new note: a confirmation of reworded text is not dropped', () => {
    const old = added(review(), target({ node: 'api' }, 'Confirmed', 'old'));
    const again = added(old.review, target({ node: 'api' }, 'Confirmed', 'rev-api'));
    expect(again).toMatchObject({ added: 1, outdated: 0 });
    expect(again.review.notes.map((n) => [n.rev, n.state])).toEqual([['old', 'outdated'], ['rev-api', 'pending']]);
  });

  it('a body with control characters is cleaned, one that is empty after that is skipped', () => {
    const out = added(review(), [...target({ title: true }, 'a\x1b]52;c;ZXZpbA==\x07b\x1b[2J‮c​d\nline 2'), ...target({ title: true }, '\x1b​  ')]);
    expect(out.added).toBe(1);
    expect(out.review.notes[0]!.body).toBe('a]52;c;ZXZpbA==b[2Jcd\nline 2');
  });
});
