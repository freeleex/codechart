// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { businessPage } from '../../src/render/business/html.js';
import { parseReviewText } from '../../src/review/import.js';
import { validateBusinessSpec } from '../../src/spec/business.js';
import { business } from '../fixtures/business.js';
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
    expect(text).toMatch(
      /^Review done: 4 notes on "New refund rules"\.\n1\. On journey "Money reaches the customer": Confirmed: Yes, that's right\n2\. On rule "Manager approval": Rejected: Applies below €100 only\n3\. On saved data "Refund reason": Comment: Keep for 7 years\n4\. On question "What happens when an agent has no manager\?": Answer: Send it to the owner\n\ncodechart review · 4 notes · [A-Za-z0-9_-]+$/,
    );
    expect(parseReviewText(text)).toMatchObject({
      slug: change.slug,
      branch: change.branch,
      at: change.at,
      notes: [
        { t: { node: 'J2' }, k: 'confirm', b: "Yes, that's right" },
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

  it('a No without a note says so; a Yes with a note is two notes', async () => {
    mount(html);
    verdict('R2', 'no');
    verdict('J2', 'yes');
    note('J2', 'Also for bank transfers?');
    expect(count()).toBe('3');
    const notes = parseReviewText(await sendBack()).notes.map((n) => [n.t, n.k, n.b]);
    expect(notes).toEqual([
      [{ node: 'J2' }, 'confirm', "Yes, that's right"],
      [{ node: 'J2' }, 'comment', 'Also for bank transfers?'],
      [{ node: 'R2' }, 'reject', "No, that's not right"],
    ]);
  });

  it('a blank answer or note counts for nothing', () => {
    mount(html);
    answer('Q1', '   ');
    note('R1', '');
    expect(count()).toBe('0');
    expect(card('R1').querySelector('[data-cbtn]')!.textContent).toBe('Add a note');
  });

  it('the note button shows when a note is there', () => {
    mount(html);
    note('R1', 'Hello');
    expect(card('R1').querySelector('[data-cbtn]')!.textContent).toBe('Edit note');
    expect(card('R1').querySelector('[data-cbtn]')!.classList.contains('has')).toBe(true);
    expect(q('#note-label').textContent).toBe('answer or note');
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
    expect(card('R2').querySelector('[data-cbox]')!.classList.contains('open')).toBe(true);
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
    expect(text).toContain('On rule "Approval – managers": Rejected: No, that\'s not right');
    expect(parseReviewText(text).notes[0]!.b).toBe("No, that's not right");
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
