import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProgramOptions } from '../../src/program.js';
import { repoFolder } from '../../src/render/output-path.js';
import { gitBranch } from '../../src/rules/git-files.js';
import { readReview, writeReview } from '../../src/review/store.js';
import { git, makeSandbox, removeSandbox, runCli } from '../helpers/sandbox.js';

let tmp: string;
let home: string;
let repo: string;
let out: string;
const t0 = new Date(2026, 9, 28, 9, 5, 3);

beforeEach(async () => {
  ({ tmp, home, repo, out } = makeSandbox('fb-import', { git: 'init', htmlOut: true }));
  mkdirSync(join(repo, 'app'));
  writeFileSync(join(repo, 'app/orders.py'), 'class Order:\n    pass\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  writeFileSync(join(repo, 'app/orders.py'), 'class Order:\n    coupon = Column(Text)\n');
  const spec = {
    title: 'Orders',
    kind: 'summary',
    nodes: [
      { id: 'Order', label: 'Order', kind: 'model', status: 'changed', layer: 'backend', path: 'app/orders.py' },
      { id: 'Queue', label: 'Queue', kind: 'other', status: 'context', layer: 'backend' },
    ],
    edges: [{ from: 'Order', to: 'Queue', label: 'publishes' }],
    gaps: ['no retry tests'],
    omitted: ['nightly cron'],
  };
  writeFileSync(join(tmp, 'spec.json'), JSON.stringify(spec));
  await run(['render', join(tmp, 'spec.json'), '--git', '--output', 'web']);
});

afterEach(() => removeSandbox(tmp));

const run = (args: string[], opts: Partial<ProgramOptions> = {}) => runCli({ cwd: repo, home, now: () => t0, isTTY: false, ...opts }, args);
const dir = () => join(out, repoFolder(repo));
const file = () => join(dir(), readdirSync(dir()).find((n) => n.endsWith('.review.json'))!);
const current = () => readReview(file())!;

type Note = { t: object; r?: string; k: 'comment' | 'question' | 'delete'; b: string };
const token = (notes: Note[], over: object = {}) => Buffer.from(JSON.stringify({ v: 1, slug: 'orders', branch: gitBranch(repo), at: t0.toISOString(), notes: notes.map(({ t, r, k }) => ({ t, r, k })), ...over })).toString('base64url');
const LABEL = { comment: 'Comment', question: 'Question', delete: 'Delete' };
const items = (notes: Note[]) => notes.map((n, i) => `${i + 1}. On somewhere: ${LABEL[n.k]}: ${n.b.replace(/\n/g, '\n   ')}`).join('\n');
const copied = (notes: Note[], over: object = {}) => `Review done:\n${items(notes)}\n\ncodechart review · ${notes.length} notes · ${token(notes, over)}\n`;
const stdin = (text: string) => ({ stdin: async () => text });
const rev = () => current().nodes.find((n) => n.id === 'Order')!.rev!;

const mixed = (): Note[] => [
  { t: { node: 'Order', path: 'app/orders.py', side: 'new', line: 2 }, r: rev(), k: 'comment', b: 'validate' },
  { t: { edge: { from: 'Order', to: 'Queue', label: 'publishes' } }, k: 'question', b: 'ordering?' },
  { t: { gap: 'no retry tests' }, k: 'comment', b: 'add them' },
  { t: { omitted: 'nightly cron' }, k: 'delete', b: 'drop it' },
  { t: { title: true }, k: 'comment', b: 'rename' },
];

describe('feedback --import', () => {
  it('saves the notes read from stdin and prints the counts', async () => {
    const r = await run(['feedback', '--import'], stdin(copied(mixed())));
    expect(r.err).toBe('✔ Imported 5 notes into "Orders"\n');
    expect(r.out).toBe('5 notes saved — 3 comments · 1 question · 1 delete\n');
    expect(r.code).toBeUndefined();
    const notes = current().notes;
    expect(notes.map((n) => [n.id, n.state])).toEqual([['n1', 'pending'], ['n2', 'pending'], ['n3', 'pending'], ['n4', 'pending'], ['n5', 'pending']]);
    expect(notes[0]).toMatchObject({ node: 'Order', anchor: { path: 'app/orders.py', side: 'new', line: 2, text: '    coupon = Column(Text)' } });
    expect(notes[1]).toMatchObject({ node: 'Order', target: { type: 'edge', from: 'Order', to: 'Queue', label: 'publishes' } });
  });

  it('reads the clipboard when nothing is piped', async () => {
    const r = await run(['feedback', '--import'], { readClipboard: () => copied(mixed().slice(2, 3)) });
    expect(r.err).toBe('✔ Imported 1 note into "Orders"\n');
    expect(current().notes[0]).toMatchObject({ target: { type: 'gap', text: 'no retry tests' }, body: 'add them' });
  });

  it('--take prints the notes in plain words and marks them sent', async () => {
    const r = await run(['feedback', '--import', '--take'], stdin(copied(mixed())));
    expect(r.out).toContain('# Review feedback: Orders (5 notes)');
    expect(r.out).toContain('1. Order (app/orders.py:2, new line)  [Order]\n   >     coupon = Column(Text)\n   Comment: validate');
    expect(r.out).toContain('2. On the arrow Order → Queue (“publishes”)\n   Question: ordering?');
    expect(r.out).toContain('3. On the gap “no retry tests”');
    expect(r.out).toContain('4. On the not-on-map item “nightly cron”\n   Delete: drop it');
    expect(r.out).toContain('5. On the title\n   Comment: rename');
    expect(current().notes.every((n) => n.state === 'sent')).toBe(true);
    expect((await run(['feedback', '--take'])).out).toBe('No pending review notes.\n');
  });

  it('notes the map changed under are saved outdated and said so; --take leaves them out', async () => {
    const notes: Note[] = [{ t: { node: 'Order' }, r: 'old-rev', k: 'comment', b: 'stale' }, { t: { gap: 'gone gap' }, k: 'comment', b: 'stale too' }, { t: { title: true }, k: 'comment', b: 'fine' }];
    const r = await run(['feedback', '--import', '--take'], stdin(copied(notes)));
    expect(r.err).toBe('✔ Imported 3 notes into "Orders" (2 outdated: the map changed since the page was drawn)\n');
    expect(r.out).toContain('(1 note)');
    expect(r.out).not.toContain('stale');
    expect(current().notes.map((n) => n.state)).toEqual(['outdated', 'outdated', 'sent']);
  });

  it('pasting the same review twice adds nothing, and says so', async () => {
    await run(['feedback', '--import'], stdin(copied(mixed())));
    const again = await run(['feedback', '--import'], stdin(copied(mixed())));
    expect(again.err).toBe('Nothing new to import: these notes are already saved.\n');
    expect(current().notes).toHaveLength(5);
    await run(['feedback', '--take']);
    const afterSent = await run(['feedback', '--import', '--take'], stdin(copied(mixed())));
    expect(afterSent.err).toBe('Nothing new to import: these notes are already saved.\n');
    expect(afterSent.out).toBe('No pending review notes.\n');
    expect(current().notes).toHaveLength(5);
  });

  it('finds the map by its slug and branch, not by the newest', async () => {
    writeFileSync(join(tmp, 'spec2.json'), JSON.stringify({ title: 'Billing', kind: 'summary', nodes: [{ id: 'B', label: 'B', kind: 'other', status: 'context', layer: 'backend' }], edges: [] }));
    await run(['render', join(tmp, 'spec2.json'), '--output', 'web']);
    const r = await run(['feedback', '--import', '--take'], stdin(copied([{ t: { title: true }, k: 'comment', b: 'on orders' }])));
    expect(r.err).toBe('✔ Imported 1 note into "Orders"\n');
    expect(r.out).toContain('# Review feedback: Orders (1 note)');
  });

  it('a map that is not there: says so and saves nothing', async () => {
    const r = await run(['feedback', '--import'], stdin(copied(mixed(), { slug: 'nope' })));
    expect(r.err).toBe(`codechart: No map called "nope" on branch ${gitBranch(repo)}. Render it again, then copy the review again.\n`);
    expect(r.code).toBe(1);
    expect(current().notes).toEqual([]);
    const other = await run(['feedback', '--import'], stdin(copied(mixed(), { branch: 'elsewhere' })));
    expect(other.err).toContain('No map called "orders" on branch elsewhere.');
  });

  it('a business page whose record is gone says it was kept 30 days', async () => {
    const r = await run(['feedback', '--import'], stdin(copied(mixed(), { slug: 'orders.business' })));
    expect(r.err).toBe(`codechart: No business page called "orders.business" on branch ${gitBranch(repo)}: its saved record is gone (kept 30 days). Render the business map again and send the new page.\n`);
    expect(r.code).toBe(1);
  });

  it('text without a review, and a damaged one, fail in plain words', async () => {
    const none = await run(['feedback', '--import'], stdin('hello'));
    expect(none.err).toBe('codechart: No codechart review found. Copy it again with "Finish review" on the page.\n');
    expect(none.code).toBe(1);
    process.exitCode = undefined;
    const bad = await run(['feedback', '--import'], stdin('codechart review · 1 note · AAAA'));
    expect(bad.err).toBe('codechart: The codechart review is damaged; copy it again with "Finish review" on the page.\n');
    const mismatch = await run(['feedback', '--import'], stdin(copied(mixed()).replace('1. On somewhere: Comment: validate', '1. On somewhere: Delete: validate')));
    expect(mismatch.err).toBe('codechart: The review text doesn\'t match its last line; copy it again with "Finish review" on the page.\n');
    expect(current().notes).toEqual([]);
  });

  it('a clipboard that cannot be read points to the pipe', async () => {
    const r = await run(['feedback', '--import'], {
      readClipboard: () => {
        throw new Error("Can't read the clipboard here. Pipe the copied review in instead: codechart feedback --import < review.txt");
      },
    });
    expect(r.err).toBe("codechart: Can't read the clipboard here. Pipe the copied review in instead: codechart feedback --import < review.txt\n");
  });

  it('does not combine with --change', async () => {
    const r = await run(['feedback', '--import', '--change', 'orders'], stdin(copied(mixed())));
    expect(r.err).toContain("option '--change <title>' cannot be used with option '--import'");
    expect(r.code).toBe(2);
    expect(current().notes).toEqual([]);
  });

  it('notes on a plan-vs-built item are saved against the drift the render listed', async () => {
    const f = file();
    writeReview(f, { ...current(), drift: [{ id: 'Order', kind: 'different', label: 'Order' }, { id: 'Cache', kind: 'missing', label: 'Cache' }] });
    const r = await run(['feedback', '--import', '--take'], stdin(copied([{ t: { drift: 'Cache', kind: 'missing' }, k: 'comment', b: 'needed' }, { t: { drift: 'Order', kind: 'different' }, k: 'question', b: 'why' }])));
    expect(r.out).toContain('1. On the plan-vs-built note of Cache (not built)');
    expect(r.out).toContain('2. On the plan-vs-built note of Order (built differently)');
    expect(current().notes[1]).toMatchObject({ node: 'Order' });
    expect(current().notes[0]!.node).toBeUndefined();
  });

  it('control characters, bidi and escapes in a pasted body never reach the file or the output', async () => {
    const evil = 'ok\x1b]52;c;ZXZpbA==\x07\x1b[2J‮​\u{e0041}end';
    const r = await run(['feedback', '--import', '--take'], stdin(copied([{ t: { title: true }, k: 'comment', b: evil }, { t: { gap: 'no retry tests' }, k: 'comment', b: '\x00\x9b31m' }])));
    expect(current().notes[0]!.body).toBe('ok]52;c;ZXZpbA==[2Jend');
    expect(r.out).toContain('Comment: ok]52;c;ZXZpbA==[2Jend');
    expect(r.out + r.err + JSON.stringify(current())).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f‮​]|\\u001b|\\u202e/);
  });

  it('a 512 KB-plus paste is refused', async () => {
    const r = await run(['feedback', '--import'], stdin('x'.repeat(513 * 1024)));
    expect(r.err).toContain('too long');
    expect(r.code).toBe(1);
  });
});
