// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compareMaps } from '../../src/render/map-drift.js';
import { parseDiff } from '../../src/render/preview.js';
import { ghostsFor } from '../../src/render/web/drift-html.js';
import { FINISH_LIMIT } from '../../src/render/web/browser/finish.js';
import { MAX_IMPORT_BYTES, parseReviewText } from '../../src/review/import.js';
import { renderHtml } from '../../src/render/web/html.js';
import { layoutSpec } from '../../src/render/web/layout.js';
import { change, click, flowNotes, key, mount, node, panesNotes, q, qa, shopNotes, shopPage, usePages } from '../helpers/page.js';

usePages();

const KEY = `codechart.notes:demo:${change.slug}:${change.at}`;
const stored = (): { id: string; t: unknown; r?: string; k: string; b: string; sent?: boolean }[] => JSON.parse(localStorage.getItem(KEY) ?? '[]');
const orders = parseDiff('shop/models/order.py', '@@ -10,2 +10,2 @@\n-old\n+new\n');
const withDiff = () => shopNotes(new Map([['tbl.orders', orders]]));
const ta = () => q<HTMLTextAreaElement>('.cm-composer textarea');
const type = (text: string) => {
  ta().value = text;
  ta().dispatchEvent(new Event('input', { bubbles: true }));
};
const save = (text: string, kind?: string) => {
  type(text);
  if (kind) click(qa('.cm-composer .cm-kind-btn').find((b) => b.textContent === kind)!);
  click(q('.cm-save'));
};
const target = (t: unknown) => qa('[data-cm]').find((b) => b.getAttribute('data-cm') === JSON.stringify(t))!;
const finishBtn = () => q<HTMLButtonElement>('#finish-review');
const tick = () => new Promise((r) => setTimeout(r, 0));
const decode = (token: string) => JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as unknown;
const message = () => q<HTMLTextAreaElement>('#finish-dialog textarea').value;

let n = 0;
const note = (t: unknown, k = 'comment', b = 'a note', extra: object = {}) => ({ id: `n${++n}`, t, k, b, at: '2026-11-05T13:00:00.000Z', ...extra });
const seed = (...notes: unknown[]) => localStorage.setItem(KEY, JSON.stringify(notes));

beforeEach(() => localStorage.clear());

const driftPage = async () => {
  const mk = (id: string) => ({ id, label: id, kind: 'other' as const, status: 'new' as const, layer: 'l' });
  const plan = { title: 'T', kind: 'plan' as const, nodes: [mk('a'), mk('gone')], edges: [{ from: 'a', to: 'gone' }] };
  const summary = { title: 'T', kind: 'summary' as const, nodes: [mk('a'), mk('z')], edges: [], drift: [{ node: 'z', cause: 'bug-found' as const, why: 'It broke.' }] };
  const ghosts = ghostsFor(compareMaps({ spec: plan, savedAt: '2026-11-06T10:00:00.000Z' }, summary), new Set(['a', 'z']), plan.edges);
  const layout = await layoutSpec({ ...summary, nodes: [...summary.nodes, ...ghosts.nodes] });
  return renderHtml(summary, layout, { generatedAt: new Date('2026-11-06T12:00:00Z'), repo: 'demo', change }, undefined, undefined, ghosts);
};

describe('a page without a review file', () => {
  it('shows no comment UI and ignores the c key', () => {
    mount(shopPage);
    expect(document.body.classList.contains('cm')).toBe(false);
    click(node('tbl.orders'));
    key('c');
    expect(qa('.cm-btn, .cm-edge-btn, .cm-composer, #finish-review')).toHaveLength(0);
    expect(JSON.parse(q('#spec-data').textContent!)).not.toHaveProperty('change');
    expect(q('#key-help').textContent).not.toContain('c: add a note');
  });

  it('a page with one carries the change in its data and lists the key', () => {
    mount(shopNotes());
    expect(JSON.parse(q('#spec-data').textContent!)).toMatchObject({ change });
    expect(q('#key-help').textContent).toContain('c: add a note');
  });
});

describe('notes on nodes', () => {
  it('the panel button adds a note with the chosen kind; the node shows a count and the panel lists it', () => {
    mount(withDiff());
    click(node('tbl.orders'));
    click(q('#panel .cm-node-btn'));
    expect(document.activeElement).toBe(ta());
    save('check the index', 'Question');
    expect(stored()).toMatchObject([{ t: { node: 'tbl.orders' }, k: 'question', b: 'check the index', r: node('tbl.orders').getAttribute('data-rev') }]);
    expect(q('#panel .cm-note .cm-body').textContent).toBe('check the index');
    expect(node('tbl.orders').querySelector('.cm-badge text')!.textContent).toBe('1');
    expect(finishBtn().textContent).toBe('Finish review (1)');
    click(node('tbl.invoices'));
    click(node('tbl.orders'));
    expect(qa('#panel .cm-note')).toHaveLength(1);
  });

  it('key c on the selected node opens the box; Cmd+Enter saves and Esc cancels', () => {
    mount(shopNotes());
    key('c');
    expect(qa('.cm-composer')).toHaveLength(0);
    click(node('tbl.customers'));
    key('c');
    type('first');
    ta().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
    expect(stored()).toMatchObject([{ t: { node: 'tbl.customers' }, k: 'comment', b: 'first' }]);
    key('c');
    type('dropped');
    ta().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(qa('.cm-composer')).toHaveLength(0);
    expect(stored()).toHaveLength(1);
  });

  it('typing c in the box does not open another one; an empty note is not saved', () => {
    mount(shopNotes());
    click(node('tbl.customers'));
    key('c');
    type('abc');
    ta().dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    expect(qa('.cm-composer')).toHaveLength(1);
    expect(ta().value).toBe('abc');
    type('   ');
    click(q('.cm-save'));
    expect(stored()).toHaveLength(0);
  });

  it('works on a flow step and shows in both panes of a Now / After map', () => {
    mount(flowNotes);
    click(node('mode'));
    click(q('#panel .cm-node-btn'));
    save('why a switch?');
    expect(node('mode').querySelector('.cm-badge')).not.toBeNull();
    mount(panesNotes);
    click(node('users'));
    key('c');
    save('hm');
    expect(qa('.node[data-id="users"] .cm-badge')).toHaveLength(2);
  });
});

describe('notes on diff lines', () => {
  it('a click on a line number takes a note on that line, old or new, shown under it', () => {
    mount(withDiff());
    click(node('tbl.orders'));
    const rows = qa('#panel .dr');
    click(rows[1]!.querySelector('.ln')!);
    save('why this?');
    expect(stored()).toMatchObject([{ t: { node: 'tbl.orders', path: 'shop/models/order.py', side: 'new', line: 10 }, b: 'why this?' }]);
    expect(rows[1]!.nextElementSibling!.classList.contains('cm-thread')).toBe(true);
    click(rows[0]!.querySelector('.ln')!);
    save('was fine', 'Delete');
    expect(stored()[1]!.t).toEqual({ node: 'tbl.orders', path: 'shop/models/order.py', side: 'old', line: 10 });
    expect(stored()[1]!.k).toBe('delete');
    click(node('tbl.invoices'));
    click(node('tbl.orders'));
    expect(qa('#panel .dr + .cm-thread')).toHaveLength(2);
  });

  it('hunk headers take no note', () => {
    mount(withDiff());
    click(node('tbl.orders'));
    click(q('#panel .hunk-sum'));
    expect(qa('.cm-composer')).toHaveLength(0);
  });
});

describe('notes on the rest of the page', () => {
  it('a plan-vs-built note, on a built node and on a ghost', async () => {
    mount(await driftPage());
    click(node('z'));
    click(q('#panel .cm-drift-btn'));
    save('ok', 'Comment');
    click(node('gone'));
    click(q('#panel .cm-drift-btn'));
    save('please build it');
    expect(stored().map((s) => s.t)).toEqual([
      { drift: 'z', kind: 'unplanned' },
      { drift: 'gone', kind: 'missing' },
    ]);
    expect(stored()[1]).not.toHaveProperty('r');
    expect(q('#panel .drift + .cm-thread .cm-body').textContent).toBe('please build it');
  });

  it('an arrow: its button opens a floating box; the saved note is listed and marks the arrow', () => {
    mount(shopNotes());
    const t = { edge: { from: 'tbl.orders', to: 'tbl.customers', label: 'customer_id' } };
    click(target(t));
    expect(q('.cm-float .cm-composer')).not.toBeNull();
    save('should be nullable?');
    expect(stored()).toMatchObject([{ t }]);
    expect(target(t).classList.contains('has')).toBe(true);
    expect(q('.cm-float')).not.toBeNull();
    click(target(t));
    expect(q('.cm-float')).toBeNull();
  });

  it('a gap and a not-on-map item, by their text', () => {
    mount(shopNotes());
    click(q('#page-info [data-notes="gap"] .cm-btn'));
    save('read them');
    click(q('#page-info [data-notes="omitted"] .cm-btn'));
    save('needed', 'Question');
    expect(stored().map((s) => s.t)).toEqual([{ gap: 'customers: columns besides id not read' }, { omitted: 'tests: test_invoice_backfill.py' }]);
    expect(qa('#page-info .cm-note')).toHaveLength(2);
  });

  it('the title', () => {
    mount(shopNotes());
    click(q('header .cm-title-btn'));
    save('rename it');
    expect(stored()).toMatchObject([{ t: { title: true }, b: 'rename it' }]);
    expect(q('.cm-float .cm-body').textContent).toBe('rename it');
  });
});

describe('saved notes', () => {
  it('survive a reload; malformed entries, over-long bodies and repeated ids are dropped', () => {
    seed(
      note({ node: 'tbl.orders' }, 'comment', 'good', { id: 'ok' }),
      note({ node: 'tbl.orders' }, 'shout', 'bad kind'),
      note({ node: 'tbl.orders', path: 'a', side: 'left', line: 1 }, 'comment', 'bad side'),
      note({ node: 7 }, 'comment', 'bad target'),
      note({ title: true }, 'comment', 'x'.repeat(4001)),
      note({ title: true }, 'comment', '  '),
      note({ title: true }, 'comment', 'same id', { id: 'ok' }),
      { not: 'a note' },
      'text',
    );
    mount(shopNotes(), false);
    expect(finishBtn().textContent).toBe('Finish review (1)');
    localStorage.setItem(KEY, '{nope');
    mount(shopNotes(), false);
    expect(finishBtn().hidden).toBe(true);
  });

  it('are kept per page: another render starts empty', () => {
    seed(note({ title: true }));
    mount(shopNotes().replaceAll(change.at, '2026-11-05T13:00:00.000Z'), false);
    expect(finishBtn().hidden).toBe(true);
  });

  it('can be edited and removed', () => {
    seed(note({ title: true }, 'comment', 'first', { id: 'one', sent: true }));
    mount(shopNotes(), false);
    expect(finishBtn().hidden).toBe(true);
    click(q('header .cm-title-btn'));
    expect(q('.cm-note.sent')).not.toBeNull();
    click(q('.cm-edit'));
    expect(ta().value).toBe('first');
    save('second', 'Question');
    expect(stored()).toMatchObject([{ id: 'one', b: 'second', k: 'question' }]);
    expect(stored()[0]).not.toHaveProperty('sent');
    expect(finishBtn().textContent).toBe('Finish review (1)');
    click(q('.cm-remove'));
    expect(stored()).toEqual([]);
    expect(finishBtn().hidden).toBe(true);
  });

  it('keep note text as text', () => {
    mount(shopNotes());
    click(q('header .cm-title-btn'));
    save('<img src=x onerror="window.pwned=1"><b>hi</b>');
    expect(q('.cm-body').textContent).toBe('<img src=x onerror="window.pwned=1"><b>hi</b>');
    expect(qa('.cm-float img, .cm-body b')).toHaveLength(0);
    click(finishBtn());
    expect(message()).toContain('Comment: <img src=x');
    expect(qa('.cm-dialog img')).toHaveLength(0);
  });
});

describe('Finish review', () => {
  const all = () =>
    seed(
      note({ node: 'tbl.orders' }, 'comment', 'first'),
      note({ node: 'tbl.orders', path: 'shop/models/order.py', side: 'new', line: 13 }, 'question', 'second\nmore', { r: 'abc' }),
      note({ drift: 'tbl.orders', kind: 'missing' }, 'delete', 'gone'),
      note({ edge: { from: 'tbl.orders', to: 'tbl.customers', label: 'customer_id' } }),
      note({ gap: 'customers: columns besides id not read' }),
      note({ omitted: 'tests: test_invoice_backfill.py' }, 'question'),
      note({ title: true }, 'comment', 'naïve ✓'),
    );

  it('is hidden without notes and counts the unsent ones', () => {
    mount(shopNotes());
    expect(finishBtn().hidden).toBe(true);
    expect(finishBtn().parentElement!.tagName).toBe('HEADER');
    seed(note({ title: true }), note({ title: true }, 'comment', 'b', { sent: true }));
    mount(shopNotes(), false);
    expect(finishBtn().hidden).toBe(false);
    expect(finishBtn().textContent).toBe('Finish review (1)');
  });

  it('opens an accessible popup with the message in plain words and a token that decodes to the notes', () => {
    all();
    mount(shopNotes(), false);
    click(finishBtn());
    const dialog = q('#finish-dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('Copy this and paste it into your agent chat.');
    expect(dialog.textContent).toContain('Or run codechart feedback --import in a terminal.');
    expect(q('.cm-copy').textContent).toBe('Copy and close');
    const [body, closing] = message().split('\n\n');
    expect(body).toBe(
      [
        'Review done: 7 notes on "Invoices for paid orders".',
        '1. On orders: Comment: first',
        '2. On line 13 of shop/models/order.py (new): Question: second\n   more',
        '3. On the plan-vs-built note of orders (not built): Delete: gone',
        '4. On the arrow orders → customers (“customer_id”): Comment: a note',
        '5. On the gap “customers: columns besides id not read”: Comment: a note',
        '6. On the not-on-map item “tests: test_invoice_backfill.py”: Question: a note',
        '7. On the title: Comment: naïve ✓',
      ].join('\n'),
    );
    const [label, count, token] = closing!.split(' · ');
    expect([label, count]).toEqual(['codechart review', '7 notes']);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decode(token!)).toEqual({
      v: 1,
      slug: change.slug,
      branch: change.branch,
      at: change.at,
      notes: [
        { t: { node: 'tbl.orders' }, k: 'comment', b: 'first' },
        { t: { node: 'tbl.orders', path: 'shop/models/order.py', side: 'new', line: 13 }, r: 'abc', k: 'question', b: 'second\nmore' },
        { t: { drift: 'tbl.orders', kind: 'missing' }, k: 'delete', b: 'gone' },
        { t: { edge: { from: 'tbl.orders', to: 'tbl.customers', label: 'customer_id' } }, k: 'comment', b: 'a note' },
        { t: { gap: 'customers: columns besides id not read' }, k: 'comment', b: 'a note' },
        { t: { omitted: 'tests: test_invoice_backfill.py' }, k: 'question', b: 'a note' },
        { t: { title: true }, k: 'comment', b: 'naïve ✓' },
      ],
    });
    expect(Object.keys(decode(token!) as object)).toEqual(['v', 'slug', 'branch', 'at', 'notes']);
  });

  it('the message holds only unsent notes', () => {
    seed(note({ title: true }, 'comment', 'old', { sent: true }), note({ gap: 'g' }, 'comment', 'new'));
    mount(shopNotes(), false);
    click(finishBtn());
    expect(message()).toContain('Review done: 1 note on');
    expect(message()).not.toContain('old');
  });

  it('Esc and Cancel close it without marking anything sent', () => {
    all();
    mount(shopNotes(), false);
    click(finishBtn());
    q('.cm-copy').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(qa('.cm-modal')).toHaveLength(0);
    click(finishBtn());
    click(q('.cm-dialog .cm-cancel'));
    expect(qa('.cm-modal')).toHaveLength(0);
    expect(stored().some((s) => s.sent)).toBe(false);
  });

  it('copying closes the popup, marks the notes sent, dims them and says Copied', async () => {
    all();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount(shopNotes(), false);
    click(finishBtn());
    const text = message();
    click(q('.cm-copy'));
    await tick();
    expect(writeText).toHaveBeenCalledWith(text);
    expect(qa('.cm-modal')).toHaveLength(0);
    expect(stored().every((s) => s.sent)).toBe(true);
    expect(finishBtn().hidden).toBe(true);
    expect(q('.cm-toast').textContent).toBe('Copied');
    click(node('tbl.orders'));
    expect(qa('#panel .cm-note.sent')).toHaveLength(1);
  });

  it('falls back to selecting the text and copying it when the clipboard API fails', async () => {
    all();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    mount(shopNotes(), false);
    click(finishBtn());
    click(q('.cm-copy'));
    await tick();
    expect(exec).toHaveBeenCalledWith('copy');
    expect(qa('.cm-modal')).toHaveLength(0);
    expect(stored().every((s) => s.sent)).toBe(true);
  });

  it('page shortcuts do nothing behind the popup; Esc still closes it', () => {
    seed(note({ title: true }));
    mount(shopNotes(), false);
    click(node('tbl.orders'));
    click(finishBtn());
    for (const k of ['r', ']', '[', 'n', 'p', 'f', 'o', 'O', '?', 'c']) key(k);
    expect(qa('.node.reviewed')).toHaveLength(0);
    expect(q<HTMLElement>('#key-help').hidden).toBe(true);
    expect(qa('.cm-composer')).toHaveLength(0);
    expect(node('tbl.orders').classList.contains('selected')).toBe(true);
    q('.cm-copy').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(qa('.cm-modal')).toHaveLength(0);
    key('r');
    expect(qa('.node.reviewed')).toHaveLength(1);
  });

  it('a review too big for the importer is copied in batches, each one importable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    seed(...Array.from({ length: 100 }, (_, i) => note({ title: true }, 'comment', `${String(i).padStart(3, '0')} ${'x'.repeat(3990)}`)));
    mount(shopNotes(), false);
    const bodies: string[] = [];
    let left = 100;
    for (let round = 0; left > 0; round++) {
      expect(round).toBeLessThan(10);
      click(finishBtn());
      const text = message();
      const got = parseReviewText(text).notes;
      expect(Buffer.byteLength(text)).toBeLessThan(FINISH_LIMIT);
      expect(got.length).toBeLessThan(100);
      if (got.length < left) {
        expect(q('#finish-dialog').textContent).toContain(`${got.length} of ${left} notes`);
        expect(q('#finish-dialog').textContent).toContain('click Finish review again for the rest');
      } else {
        expect(q('#finish-dialog').textContent).not.toContain('for the rest');
      }
      bodies.push(...got.map((g) => g.b.slice(0, 3)));
      click(q('.cm-copy'));
      await tick();
      expect(writeText).toHaveBeenLastCalledWith(text);
      left -= got.length;
      expect(finishBtn().hidden).toBe(left === 0);
      if (left) expect(finishBtn().textContent).toBe(`Finish review (${left})`);
    }
    expect(bodies).toEqual(Array.from({ length: 100 }, (_, i) => String(i).padStart(3, '0')));
  });

  it('a batch holds at least one note, and a review that fits is not split', () => {
    seed(note({ title: true }, 'comment', '\u0001'.repeat(4000)));
    mount(shopNotes(), false);
    click(finishBtn());
    expect(Buffer.byteLength(message())).toBeLessThan(FINISH_LIMIT);
    expect(q('#finish-dialog').textContent).not.toContain('for the rest');
    expect(parseReviewText(message()).notes).toHaveLength(1);
  });

  it('the page limit is below what the importer accepts', () => {
    expect(FINISH_LIMIT).toBeLessThan(MAX_IMPORT_BYTES);
  });

  it('when nothing can copy, the popup stays with the text selected and a hint', async () => {
    all();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
    mount(shopNotes(), false);
    click(finishBtn());
    click(q('.cm-copy'));
    await tick();
    expect(q('#finish-dialog')).not.toBeNull();
    expect(q<HTMLElement>('.cm-hint').hidden).toBe(false);
    expect(q('.cm-hint').textContent).toBe('Press Cmd+C (Ctrl+C) to copy.');
    expect(document.activeElement).toBe(q('#finish-dialog textarea'));
    expect(stored().some((s) => s.sent)).toBe(false);
    expect(finishBtn().textContent).toBe('Finish review (7)');
  });
});
