// @vitest-environment happy-dom
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgramOptions } from '../../src/program.js';
import { repoFolder } from '../../src/render/output-path.js';
import { readReview } from '../../src/review/store.js';
import { click, mount, node, q, qa, usePages } from '../helpers/page.js';
import { git, makeSandbox, removeSandbox, runCli } from '../helpers/sandbox.js';

usePages();

let tmp: string;
let home: string;
let repo: string;
let out: string;
const planned = new Date(2026, 9, 28, 9, 0, 0);
const built = new Date(2026, 9, 28, 9, 5, 3);
const later = new Date(2026, 9, 28, 9, 30, 0);

const mk = (id: string, status: string, extra: object = {}) => ({ id, label: id, kind: 'other', status, layer: 'backend', ...extra });
const GAP = 'retry & "backoff" tests <not> written';
const PLAN = { title: 'Orders', kind: 'plan', nodes: [mk('Order', 'changed', { path: 'app/orders.py' }), mk('Queue', 'context'), mk('Cache', 'new')], edges: [] };
const SUMMARY = {
  title: 'Orders',
  kind: 'summary',
  nodes: [mk('Order', 'changed', { path: 'app/orders.py' }), mk('Queue', 'context'), mk('Extra', 'new')],
  edges: [{ from: 'Order', to: 'Queue', label: 'publishes' }],
  gaps: [GAP],
  omitted: ['nightly cron'],
  drift: [{ node: 'Cache', cause: 'bug-found', why: 'it deadlocked' }],
};

beforeEach(() => {
  ({ tmp, home, repo, out } = makeSandbox('roundtrip', { git: 'init', htmlOut: true }));
  mkdirSync(join(repo, 'app'));
  writeFileSync(join(repo, 'app/orders.py'), 'class Order:\n    pass\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  writeFileSync(join(repo, 'app/orders.py'), 'class Order:\n    coupon = Column(Text)\n');
});
afterEach(() => removeSandbox(tmp));

const run = (args: string[], now: Date, opts: Partial<ProgramOptions> = {}) => runCli({ cwd: repo, home, now: () => now, isTTY: false, ...opts }, args);
const render = (spec: unknown, now: Date, ...args: string[]) => {
  writeFileSync(join(tmp, 'spec.json'), JSON.stringify(spec));
  return run(['render', join(tmp, 'spec.json'), '--git', ...args], now);
};
const dir = () => join(out, repoFolder(repo));
const names = (ext: string) => readdirSync(dir()).filter((n) => n.endsWith(ext)).sort();
const page = (i = 0) => readFileSync(join(dir(), names('.html')[i]!), 'utf8');
const review = () => readReview(join(dir(), names('.review.json').at(-1)!))!;
const stdin = (text: string) => ({ stdin: async () => text });

const ta = () => q<HTMLTextAreaElement>('.cm-composer textarea');
const save = (text: string, kind?: string) => {
  ta().value = text;
  ta().dispatchEvent(new Event('input', { bubbles: true }));
  if (kind) click(qa('.cm-composer .cm-kind-btn').find((b) => b.textContent === kind)!);
  click(q('.cm-save'));
};
const target = (t: unknown) => qa('[data-cm]').find((b) => b.getAttribute('data-cm') === JSON.stringify(t))!;
const row = (cls: string) => q(`#panel .dr.${cls}`);

async function copyFinish(): Promise<string> {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  click(q('#finish-review'));
  click(q('.cm-copy'));
  await new Promise((r) => setTimeout(r, 0));
  expect(writeText).toHaveBeenCalledTimes(1);
  return writeText.mock.calls[0]![0] as string;
}

/** One note on every kind of place the page offers. */
function takeNotes(): void {
  click(node('Order'));
  click(q('#panel .cm-node-btn'));
  save('first line\nsecond line', 'Comment');
  click(row('d-add').querySelector('.ln')!);
  save('why this?', 'Question');
  click(row('d-del').querySelector('.ln')!);
  save('keep it', 'Delete');
  click(node('Extra'));
  click(q('#panel .cm-drift-btn'));
  save('not asked for');
  click(node('Cache'));
  click(q('#panel .cm-drift-btn'));
  save('please build it', 'Question');
  click(target({ edge: { from: 'Order', to: 'Queue', label: 'publishes' } }));
  save('ordering?');
  click(q('#page-info [data-notes="gap"] .cm-btn'));
  save('add them');
  click(q('#page-info [data-notes="omitted"] .cm-btn'));
  save('drop it', 'Delete');
  click(q('header .cm-title-btn'));
  save('rename it');
}

describe('page → Finish review → feedback --import', () => {
  it('every kind of note the page takes is imported, with the right place, anchor and state', async () => {
    await render(PLAN, planned, '--output', 'cli');
    await render(SUMMARY, built, '--output', 'web');
    mount(page());
    takeNotes();
    expect(q('#finish-review').textContent).toBe('Finish review (9)');
    const text = await copyFinish();
    expect(text).toMatch(/\ncodechart review · 9 notes · [A-Za-z0-9_-]+$/);

    const r = await run(['feedback', '--import', '--take'], built, stdin(text));
    expect(r.err).toBe('✔ Imported 9 notes into "Orders"\n');
    expect(r.code).toBeUndefined();
    expect(r.out).toContain('# Review feedback: Orders (9 notes)');
    expect(r.out).toContain('1. Order (app/orders.py)  [Order]\n   Comment: first line\n   second line');
    expect(r.out).toContain('2. Order (app/orders.py:2, new line)  [Order]\n   >     coupon = Column(Text)\n   Question: why this?');
    expect(r.out).toContain('3. Order (app/orders.py:2, old line)  [Order]\n   >     pass\n   Delete: keep it');
    expect(r.out).toContain('4. On the plan-vs-built note of Extra (built, not in the plan)\n   Comment: not asked for');
    expect(r.out).toContain('5. On the plan-vs-built note of Cache (not built)\n   Question: please build it');
    expect(r.out).toContain('6. On the arrow Order → Queue (“publishes”)\n   Comment: ordering?');
    expect(r.out).toContain(`7. On the gap “${GAP}”\n   Comment: add them`);
    expect(r.out).toContain('8. On the not-on-map item “nightly cron”\n   Delete: drop it');
    expect(r.out).toContain('9. On the title\n   Comment: rename it');

    const notes = review().notes;
    expect(notes.map((n) => n.state)).toEqual(Array(9).fill('sent'));
    expect(notes[0]).toMatchObject({ node: 'Order', kind: 'comment', body: 'first line\nsecond line' });
    expect(notes[1]).toMatchObject({ node: 'Order', kind: 'question', anchor: { path: 'app/orders.py', side: 'new', line: 2, text: '    coupon = Column(Text)' } });
    expect(notes[2]).toMatchObject({ node: 'Order', kind: 'delete', anchor: { path: 'app/orders.py', side: 'old', line: 2, text: '    pass' } });
    expect(notes[3]).toMatchObject({ node: 'Extra', target: { type: 'drift', id: 'Extra', kind: 'unplanned' } });
    expect(notes[4]).toMatchObject({ kind: 'question', target: { type: 'drift', id: 'Cache', kind: 'missing' } });
    expect(notes[5]).toMatchObject({ node: 'Order', target: { type: 'edge', from: 'Order', to: 'Queue', label: 'publishes' } });
    expect(notes[6]).toMatchObject({ target: { type: 'gap', text: GAP } });
    expect(notes[7]).toMatchObject({ kind: 'delete', target: { type: 'omitted', text: 'nightly cron' } });
    expect(notes[8]).toMatchObject({ target: { type: 'title' } });

    const again = await run(['feedback', '--import', '--take'], built, stdin(text));
    expect(again.err).toBe('Nothing new to import: these notes are already saved.\n');
    expect(review().notes).toHaveLength(9);
  });

  it('multi-line bodies, a body with ": Comment: " and a gap with ": " survive the trip; the token holds no words', async () => {
    const gap = 'retry: tests';
    await render({ ...SUMMARY, gaps: [gap] }, built, '--output', 'web');
    mount(page());
    click(node('Order'));
    click(q('#panel .cm-node-btn'));
    save('line one\n\n  indented: Comment: two\n3. not an item', 'Question');
    click(q('#page-info [data-notes="gap"] .cm-btn'));
    save('add: them\nplease');
    const text = await copyFinish();
    expect(text.split(' · ').at(-1)!.length).toBeLessThan(400);
    expect(text.split(' · ').at(-1)).not.toContain('line');
    const r = await run(['feedback', '--import'], built, stdin(text));
    expect(r.err).toBe('✔ Imported 2 notes into "Orders"\n');
    expect(review().notes.map((n) => [n.kind, n.body, n.target])).toEqual([
      ['question', 'line one\n\n  indented: Comment: two\n3. not an item', undefined],
      ['comment', 'add: them\nplease', { type: 'gap', text: gap }],
    ]);
  });

  it('a note on a line of a node that changed since the page was drawn comes in outdated; the others stay pending', async () => {
    await render(SUMMARY, built, '--output', 'web');
    mount(page());
    click(node('Order'));
    click(q('#panel .cm-node-btn'));
    save('plain note on Order');
    click(row('d-add').querySelector('.ln')!);
    save('line note');
    click(q('#page-info [data-notes="gap"] .cm-btn'));
    save('gap note');
    click(node('Queue'));
    click(q('#panel .cm-node-btn'));
    save('queue note');
    const text = await copyFinish();

    writeFileSync(join(repo, 'app/orders.py'), 'class Order:\n    coupon = Column(Text, nullable=False)\n');
    await render(SUMMARY, later, '--output', 'web');

    const r = await run(['feedback', '--import'], later, stdin(text));
    expect(r.err).toBe('✔ Imported 4 notes into "Orders" (2 outdated: the map changed since the page was drawn)\n');
    const byBody = Object.fromEntries(review().notes.map((n) => [n.body, n.state]));
    expect(byBody).toEqual({ 'plain note on Order': 'outdated', 'line note': 'outdated', 'gap note': 'pending', 'queue note': 'pending' });
  });

  it('a gap and a not-on-map item with invisible characters import as pending, stored sanitized', async () => {
    await render({ ...SUMMARY, gaps: ['no​ tests‮ here'], omitted: ['cron⁠ job'] }, built, '--output', 'web');
    mount(page());
    click(q('#page-info [data-notes="gap"] .cm-btn'));
    save('add them');
    click(q('#page-info [data-notes="omitted"] .cm-btn'));
    save('drop it');
    const r = await run(['feedback', '--import'], built, stdin(await copyFinish()));
    expect(r.err).toBe('✔ Imported 2 notes into "Orders"\n');
    expect(review().notes.map((n) => [n.state, n.target])).toEqual([['pending', { type: 'gap', text: 'no tests here' }], ['pending', { type: 'omitted', text: 'cron job' }]]);
  });

  it('a note on a faded arrow from the plan imports pending', async () => {
    await render({ ...PLAN, edges: [{ from: 'Order', to: 'Cache', label: 'invalidates' }] }, planned, '--output', 'cli');
    await render(SUMMARY, built, '--output', 'web');
    mount(page());
    click(target({ edge: { from: 'Order', to: 'Cache', label: 'invalidates' } }));
    save('still wanted?');
    const r = await run(['feedback', '--import'], built, stdin(await copyFinish()));
    expect(r.err).toBe('✔ Imported 1 note into "Orders"\n');
    expect(review().notes.map((n) => [n.state, n.target])).toEqual([['pending', { type: 'edge', from: 'Order', to: 'Cache', label: 'invalidates' }]]);
  });

  it('the same text read from the clipboard imports the same way', async () => {
    await render(SUMMARY, built, '--output', 'web');
    mount(page());
    click(q('header .cm-title-btn'));
    save('rename it');
    click(q('#page-info [data-notes="gap"] .cm-btn'));
    save('add them', 'Question');
    const text = await copyFinish();
    const r = await run(['feedback', '--import'], built, { stdinPiped: () => false, readClipboard: () => `${text}\n` });
    expect(r.err).toBe('✔ Imported 2 notes into "Orders"\n');
    expect(r.out).toBe('2 notes saved — 1 comment · 1 question · 0 deletes\n');
    expect(review().notes.map((n) => [n.state, n.target])).toEqual([['pending', { type: 'title' }], ['pending', { type: 'gap', text: GAP }]]);
  });

  it('a flow page hands its step notes over the same way', async () => {
    const flow = {
      title: 'Invite',
      kind: 'summary',
      start: 'a',
      steps: [
        { id: 'a', label: 'a', status: 'existing', source: 'app/orders.py:1' },
        { id: 'b', label: 'b', status: 'new', source: 'app/orders.py:2' },
      ],
      links: [{ from: 'a', to: 'b' }],
    };
    await render(flow, built, '--output', 'web');
    mount(page());
    click(node('b'));
    click(q('#panel .cm-node-btn'));
    save('why a step?', 'Question');
    click(q('header .cm-title-btn'));
    save('rename it');
    const r = await run(['feedback', '--import', '--take'], built, stdin(await copyFinish()));
    expect(r.err).toBe('✔ Imported 2 notes into "Invite"\n');
    expect(r.out).toContain('Question: why a step?');
    expect(r.out).toContain('2. On the title\n   Comment: rename it');
    expect(review().notes.map((n) => [n.node, n.state])).toEqual([['b', 'sent'], [undefined, 'sent']]);
  });
});
