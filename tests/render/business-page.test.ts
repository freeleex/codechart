// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { businessPage } from '../../src/render/business/html.js';
import { carryNotes } from '../../src/review/carry.js';
import { importNotes, parseReviewText } from '../../src/review/import.js';
import type { Note, Review, ReviewNode } from '../../src/review/schema.js';
import { businessSnapshot } from '../../src/review/snapshot.js';
import { validateBusinessSpec, type ChangeSpec } from '../../src/spec/business.js';
import { business } from '../fixtures/business.js';
import { review } from '../review/fixture.js';
import { click, mount, q, qa, usePages } from '../helpers/page.js';

usePages();

const change = { slug: 'new-refund-rules.business', branch: 'feat/refunds', at: '2026-11-08T12:00:00.000Z' };
const KEY = `codechart.business:demo:${change.slug}:${change.at}`;
const parsed = validateBusinessSpec(business());
if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
const html = businessPage(parsed.spec, { generatedAt: new Date('2026-11-08T12:00:00Z'), repo: 'demo', change });

const card = (id: string) => q(`[data-item="${id}"]`);
const type = (el: HTMLTextAreaElement, text: string) => {
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const note = (id: string, text: string) => {
  click(card(id).querySelector('[data-cbtn]')!);
  type(card(id).querySelector<HTMLTextAreaElement>('[data-note]')!, text);
};
const verdict = (id: string, v: 'yes' | 'no') => click(card(id).querySelector(`[data-verdict="${v}"]`)!);
const answer = (id: string, text: string) => type(card(id).querySelector<HTMLTextAreaElement>('[data-answer]')!, text);
const count = () => q('#note-count').textContent;
const send = () => q<HTMLButtonElement>('#send');
const tick = () => new Promise((r) => setTimeout(r, 0));

async function sendBack(): Promise<string> {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  click(send());
  await tick();
  expect(writeText).toHaveBeenCalledTimes(1);
  return writeText.mock.calls[0]![0] as string;
}

describe('business page in the browser', () => {
  it('sends a short v2 token, shows the closing line on one line and keeps the full text for the clipboard', async () => {
    mount(html);
    answer('Q1', 'Send it to the owner');
    verdict('R2', 'no');
    note('R2', 'Applies below €100 only');
    verdict('J2', 'yes');
    note('D1', 'Keep for 7 years');
    note('J1', 'Rename it');
    const text = await sendBack();
    const token = text.split(' · ').at(-1)!;
    expect(token.length).toBeLessThanOrEqual(230);
    const json = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as { v: number; s: string; n: string[][] };
    expect(json.v).toBe(2);
    expect(json.s).toBe('new-refund-rules');
    expect(json.n.map((x) => x[1])).toEqual(['c', 'y', 'n', 'c', 'a']);
    expect(json.n.every((x) => /^[A-Za-z0-9_-]{6}$/.test(x[2]!))).toBe(true);
    const line = q('#send-token');
    expect(line.textContent).toBe(`codechart review · 5 notes · ${token}`);
    expect(line.getAttribute('aria-label')).toBe("Code that tells the developer's tool which page this is");
    expect((line as HTMLElement).title).toBe("Code that tells the developer's tool which page this is");
    expect(q('#send-text').textContent).toBe(text);
  });

  it('starts with nothing to send', () => {
    mount(html);
    expect(count()).toBe('0');
    expect(send().disabled).toBe(true);
    expect(q<HTMLElement>('#send-modal').hidden).toBe(true);
  });

  it('answers, Yes, No with a note and a comment are counted and sent in the P33 format', async () => {
    mount(html);
    answer('Q1', 'Send it to the owner');
    verdict('R2', 'no');
    expect(card('R2').querySelector('[data-cbox]')!.classList.contains('open')).toBe(true);
    note('R2', 'Applies below €100 only');
    verdict('J2', 'yes');
    note('D1', 'Keep for 7 years');
    expect(count()).toBe('4');
    expect(q('#note-label').textContent).toBe('answers and notes');
    expect(send().disabled).toBe(false);

    const text = await sendBack();
    expect(q<HTMLElement>('#send-modal').hidden).toBe(false);
    expect(q('#send-title').textContent).toBe('Copied — paste it to the developer');
    expect(q('#send-text').textContent).toBe(text);
    expect(q('#send-when').textContent).toBe("You can send it whenever you're ready, in an email or chat message.");
    expect(text).toMatch(
      /^Review done: 4 answers and notes on "New refund rules"\.\n1\. On journey "Money reaches the customer": Confirmed\n2\. On rule "Manager approval": Rejected: Applies below €100 only\n3\. On saved data "Refund reason": Comment: Keep for 7 years\n4\. On question "What happens when an agent has no manager\?": Answer: Send it to the owner\n\ncodechart review · 4 notes · [A-Za-z0-9_-]+$/,
    );
    expect(parseReviewText(text)).toMatchObject({
      slug: change.slug,
      branch: change.branch,
      notes: [
        { t: { node: 'J2' }, k: 'confirm', b: 'Confirmed' },
        { t: { node: 'R2' }, k: 'reject', b: 'Applies below €100 only' },
        { t: { node: 'D1' }, k: 'comment', b: 'Keep for 7 years' },
        { t: { node: 'Q1' }, k: 'answer', b: 'Send it to the owner' },
      ],
    });
  });

  it('Yes and No toggle: pressing again clears, and the pressed state shows', () => {
    mount(html);
    const state = () => [...card('R2').querySelectorAll('[data-verdict]')].map((b) => b.getAttribute('aria-pressed'));
    verdict('R2', 'yes');
    expect(state()).toEqual(['true', 'false']);
    expect(count()).toBe('1');
    verdict('R2', 'no');
    expect(state()).toEqual(['false', 'true']);
    verdict('R2', 'no');
    expect(state()).toEqual(['false', 'false']);
    expect(count()).toBe('0');
  });

  it('a Yes or No without a note says just that; with a note it carries it', async () => {
    mount(html);
    verdict('R2', 'no');
    verdict('J2', 'yes');
    note('J2', 'Also for bank transfers?');
    expect(count()).toBe('2');
    const notes = parseReviewText(await sendBack()).notes.map((n) => [n.t, n.k, n.b]);
    expect(notes).toEqual([
      [{ node: 'J2' }, 'confirm', 'Also for bank transfers?'],
      [{ node: 'R2' }, 'reject', 'Rejected'],
    ]);
  });

  it('a blank answer or note counts for nothing', () => {
    mount(html);
    answer('Q1', '   ');
    note('R1', '  ');
    click(card('R1').querySelector('[data-cbtn]')!);
    expect(count()).toBe('0');
    expect(card('R1').querySelector('[data-cbtn]')!.textContent).toBe('Add a note');
  });

  it('the note box is Done while open, then a preview with Edit note and Remove', () => {
    mount(html);
    const btn = () => card('R1').querySelector<HTMLElement>('[data-cbtn]')!;
    const box = () => card('R1').querySelector('[data-cbox]')!;
    const view = () => card('R1').querySelector<HTMLElement>('[data-cview]')!;
    const remove = () => card('R1').querySelector<HTMLElement>('[data-crm]')!;
    note('R1', 'Hello');
    expect(btn().textContent).toBe('Done');
    expect(btn().getAttribute('aria-expanded')).toBe('true');
    expect(btn().getAttribute('aria-controls')).toBe(box().querySelector('textarea')!.id);
    expect(view().hidden).toBe(true);
    click(btn());
    expect(box().classList.contains('open')).toBe(false);
    expect(btn().textContent).toBe('Edit note');
    expect(btn().getAttribute('aria-expanded')).toBe('false');
    expect(view().hidden).toBe(false);
    expect(view().textContent).toBe('Your note:Hello');
    expect(view().querySelector('[data-cprev]')!.getAttribute('title')).toBe('Hello');
    expect(remove().hidden).toBe(false);
    expect(q('#note-label').textContent).toBe('answer or note');
  });

  it('a note shows as text, never as markup', () => {
    mount(html);
    note('R1', '<img src=x onerror=alert(1)>');
    click(card('R1').querySelector('[data-cbtn]')!);
    expect(card('R1').querySelector('[data-cview] img')).toBeNull();
    expect(card('R1').querySelector('[data-cview]')!.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('Edit note reopens the box with the words; the preview does too', () => {
    mount(html);
    note('R1', 'Hello');
    click(card('R1').querySelector('[data-cbtn]')!);
    click(card('R1').querySelector('[data-cbtn]')!);
    const area = card('R1').querySelector<HTMLTextAreaElement>('[data-note]')!;
    expect(card('R1').querySelector('[data-cbox]')!.classList.contains('open')).toBe(true);
    expect(area.value).toBe('Hello');
    expect(document.activeElement).toBe(area);
    expect(area.selectionStart).toBe(5);
    click(card('R1').querySelector('[data-cbtn]')!);
    click(card('R1').querySelector('[data-cprev]')!);
    expect(card('R1').querySelector('[data-cbox]')!.classList.contains('open')).toBe(true);
  });

  it('Remove clears the note, the count and what is saved', () => {
    mount(html);
    note('R1', 'Hello');
    note('R2', 'Again');
    click(card('R1').querySelector('[data-cbtn]')!);
    click(card('R2').querySelector('[data-cbtn]')!);
    expect(count()).toBe('2');
    click(card('R1').querySelector('[data-crm]')!);
    expect(count()).toBe('1');
    expect(card('R1').querySelector<HTMLTextAreaElement>('[data-note]')!.value).toBe('');
    expect(card('R1').querySelector('[data-cbtn]')!.textContent).toBe('Add a note');
    expect(card('R1').querySelector<HTMLElement>('[data-cview]')!.hidden).toBe(true);
    expect(card('R1').querySelector<HTMLElement>('[data-crm]')!.hidden).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY)!).note.R1).toBeUndefined();
    expect(JSON.parse(localStorage.getItem(KEY)!).note.R2).toBe('Again');
  });

  it('closing an empty box goes back to Add a note with no preview', () => {
    mount(html);
    click(card('R1').querySelector('[data-cbtn]')!);
    expect(card('R1').querySelector('[data-cbtn]')!.textContent).toBe('Done');
    click(card('R1').querySelector('[data-cbtn]')!);
    expect(card('R1').querySelector('[data-cbtn]')!.textContent).toBe('Add a note');
    expect(card('R1').querySelector<HTMLElement>('[data-cview]')!.hidden).toBe(true);
  });

  it('Escape in the box closes it; Done after No keeps the No', () => {
    mount(html);
    verdict('R2', 'no');
    const area = card('R2').querySelector<HTMLTextAreaElement>('[data-note]')!;
    type(area, 'Below €100');
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(card('R2').querySelector('[data-cbox]')!.classList.contains('open')).toBe(false);
    expect(card('R2').querySelector<HTMLElement>('[data-cview]')!.hidden).toBe(false);
    expect(card('R2').querySelector('[data-verdict="no"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('a reload keeps the answers, the verdicts and the notes', () => {
    mount(html);
    answer('Q1', 'Owner');
    verdict('R2', 'no');
    note('R2', 'Below €100');
    mount(html, false);
    expect(count()).toBe('2');
    expect(card('Q1').querySelector<HTMLTextAreaElement>('[data-answer]')!.value).toBe('Owner');
    expect(card('R2').querySelector('[data-verdict="no"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(card('R2').querySelector<HTMLTextAreaElement>('[data-note]')!.value).toBe('Below €100');
    expect(card('R2').querySelector('[data-cbox]')!.classList.contains('open')).toBe(false);
    expect(card('R2').querySelector<HTMLElement>('[data-cview]')!.hidden).toBe(false);
    expect(card('R2').querySelector('[data-cview]')!.textContent).toBe('Your note:Below €100');
    expect(card('R2').querySelector('[data-cbtn]')!.textContent).toBe('Edit note');
  });

  it('ignores saved junk: unknown items, bad verdicts, oversized text, wrong shapes', () => {
    localStorage.setItem(KEY, JSON.stringify({ verdict: { R2: 'maybe', X9: 'yes' }, note: { R1: 'x'.repeat(5000), nope: 'hi' }, answer: { Q1: 7 } }));
    mount(html, false);
    expect(count()).toBe('0');
    localStorage.setItem(KEY, '[1,2');
    mount(html, false);
    expect(count()).toBe('0');
  });

  it('Copy again copies the same text; Done and Escape close the dialog', async () => {
    mount(html);
    answer('Q1', 'Owner');
    const text = await sendBack();
    const writeText = vi.mocked(navigator.clipboard.writeText);
    click(q('#send-copy'));
    await tick();
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenLastCalledWith(text);
    click(q('#send-done'));
    expect(q<HTMLElement>('#send-modal').hidden).toBe(true);
    click(send());
    await tick();
    expect(q<HTMLElement>('#send-modal').hidden).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(q<HTMLElement>('#send-modal').hidden).toBe(true);
  });

  it('a blocked clipboard says to copy by hand; the text stays on screen', async () => {
    mount(html);
    answer('Q1', 'Owner');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(false);
    click(send());
    await tick();
    expect(q('#send-title').textContent).toBe('Copy this text, then paste it to the developer');
    expect(q('#send-hint').textContent).toContain('Cmd+C');
    expect(q('#send-text').textContent).toContain('Answer: Owner');
  });

  it('a place with ": " in its name stays one place in the message', async () => {
    const raw = business();
    raw.rules[1].name = 'Approval: managers';
    const r = validateBusinessSpec(raw);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    mount(businessPage(r.spec, { generatedAt: new Date(), repo: 'demo', change }));
    verdict('R2', 'no');
    const text = await sendBack();
    expect(text).toContain('On rule "Approval – managers": Rejected\n');
    expect(parseReviewText(text).notes[0]!.b).toBe('Rejected');
  });

  it('the "about" link scrolls to its item and flashes it', () => {
    mount(html);
    const link = q('.qa .about a');
    click(link);
    expect(q('#i-R2').classList.contains('flash')).toBe(true);
  });

  it('does not start the map script: no map markup is needed', () => {
    mount(html);
    expect(qa('.canvas, #panel, #theme-toggle')).toHaveLength(0);
  });
});

describe('business items that change', () => {
  const pageOf = (raw: ReturnType<typeof business>) => {
    const r = validateBusinessSpec(raw);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    return { spec: r.spec as ChangeSpec, html: businessPage(r.spec, { generatedAt: new Date(), repo: 'demo', change }) };
  };
  const reviewOf = (nodes: ReviewNode[], notes: Note[] = []): Review => ({ ...review(notes, nodes), change: { ...review().change, kind: 'business' } });

  it('the rev of an item follows its words and links, not its neighbours', () => {
    const nodes = (raw: ReturnType<typeof business>) => Object.fromEntries(businessSnapshot(pageOf(raw).spec).nodes.map((n) => [n.id, n.rev]));
    const before = nodes(business());
    const raw = business();
    raw.rules[1].after = 'A refund above €50 waits for the agent\'s manager.';
    const after = nodes(raw);
    expect(before.R2).toMatch(/^[0-9a-f]{6}$/);
    expect(after.R2).not.toBe(before.R2);
    expect({ ...after, R2: 0 }).toEqual({ ...before, R2: 0 });
  });

  it('a Yes on an item whose words changed arrives outdated', async () => {
    mount(pageOf(business()).html);
    verdict('R2', 'yes');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    click(send());
    await tick();
    const pasted = parseReviewText(writeText.mock.calls[0]![0] as string);
    expect(pasted.notes[0]!.r).toMatch(/^[0-9a-f]{6}$/);

    const changed = business();
    changed.rules[1].after = 'A refund above €50 waits for the agent\'s manager.';
    const same = importNotes(reviewOf(businessSnapshot(pageOf(business()).spec).nodes), pasted, new Date());
    expect(same).toMatchObject({ added: 1, outdated: 0 });
    const out = importNotes(reviewOf(businessSnapshot(pageOf(changed).spec).nodes), pasted, new Date());
    expect(out).toMatchObject({ added: 1, outdated: 1 });
  });

  it('a pending note on an item whose words changed turns outdated when carried', () => {
    const old = businessSnapshot(pageOf(business()).spec).nodes;
    const n: Note = { id: 'n1', node: 'R2', rev: old.find((x) => x.id === 'R2')!.rev, kind: 'confirm', body: 'Confirmed', state: 'pending', at: '' };
    const changed = business();
    changed.rules[1].after = 'A refund above €50 waits for the agent\'s manager.';
    const [out] = carryNotes(reviewOf(old, [n]), businessSnapshot(pageOf(changed).spec).nodes);
    expect(out!.state).toBe('outdated');
  });

  it('items named like Object properties work', () => {
    const raw = business();
    raw.rules[0].id = 'toString';
    raw.rules[1].id = 'constructor';
    raw.questions[0].about = 'constructor';
    mount(pageOf(raw).html);
    verdict('constructor', 'yes');
    note('toString', 'Check this');
    expect(count()).toBe('2');
    mount(pageOf(raw).html, false);
    expect(count()).toBe('2');
  });
});
