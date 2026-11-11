// Runs in the generated business page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.
import { copyNoteText, finishMessage } from './finish.js';
import type { Change, Note } from './note-store.js';
import { load, save } from './store.js';
import { isObj, type NoteTarget } from './targets.js';

type Verdict = 'yes' | 'no';

interface BizState {
  verdict: Record<string, Verdict>;
  note: Record<string, string>;
  answer: Record<string, string>;
}

const BIZ_MAX = 4000;
const BIZ_WORD: Record<string, string> = { journey: 'journey', rule: 'rule', data: 'saved data', question: 'question' };

const bizCards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-item]')];

const bare = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

/** What the page saved for the visitor, limited to the items it has and to text of a sane size. */
function bizSaved(key: string, ids: Set<string>): BizState {
  const out: BizState = { verdict: bare(), note: bare(), answer: bare() };
  try {
    const v = JSON.parse(load(key) ?? '{}') as unknown;
    if (!isObj(v)) return out;
    for (const [field, map] of [['note', out.note], ['answer', out.answer]] as const) {
      const from = v[field];
      if (!isObj(from)) continue;
      for (const [id, text] of Object.entries(from)) if (ids.has(id) && typeof text === 'string' && text.length <= BIZ_MAX) map[id] = text;
    }
    if (isObj(v.verdict)) for (const [id, val] of Object.entries(v.verdict)) if (ids.has(id) && (val === 'yes' || val === 'no')) out.verdict[id] = val;
  } catch {
    // starts empty
  }
  return out;
}

/** The notes the answers, verdicts and comments make, in page order. A Yes or No takes the comment as its words, none when there is no comment. */
function bizNotes(s: BizState): Note[] {
  const at = new Date().toISOString();
  const out: Note[] = [];
  for (const card of bizCards()) {
    const id = card.dataset.item!;
    const r = card.dataset.rev;
    const add = (k: Note['k'], b: string) => out.push({ id: `${id}:${k}`, t: { node: id }, ...(r && { r }), k, b, at });
    const comment = (s.note[id] ?? '').trim();
    if (card.dataset.kind === 'question') {
      const answer = (s.answer[id] ?? '').trim();
      if (answer) add('answer', answer);
      continue;
    }
    if (s.verdict[id] === 'yes') add('confirm', comment);
    else if (s.verdict[id] === 'no') add('reject', comment);
    else if (comment) add('comment', comment);
  }
  return out;
}

/** "rule "Refund window"": the item in plain words. A ": " inside would be read as the end of the place, so it becomes a dash. */
function bizPlace(t: NoteTarget): string {
  const card = 'node' in t ? bizCards().find((c) => c.dataset.item === t.node) : undefined;
  if (!card) return 'the page';
  const name = card.dataset.name!.replace(/\s+/g, ' ');
  const shown = name.length > 80 ? `${name.slice(0, 79)}…` : name;
  return `${BIZ_WORD[card.dataset.kind!]} "${shown}"`.replace(/: /g, ' – ');
}

const bizCount = (n: number): string => `${n} ${n === 1 ? 'answer or note' : 'answers and notes'}`;

const bizEl = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function bizSelect(pre: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(pre);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function bizSend(s: BizState, change: Change): void {
  const list = bizNotes(s);
  if (!list.length) return;
  const text = finishMessage(document.querySelector('h1')!.textContent!, change, list, bizPlace, bizCount, true);
  const modal = bizEl('send-modal');
  const pre = bizEl('send-text');
  const title = bizEl('send-title');
  const hint = bizEl('send-hint');
  const cut = text.lastIndexOf('\n\ncodechart review ·') + 2;
  const tip = "Code that tells the developer's tool which page this is";
  const last = document.createElement('span');
  last.id = 'send-token';
  last.title = tip;
  last.setAttribute('aria-label', tip);
  last.textContent = text.slice(cut);
  pre.replaceChildren(text.slice(0, cut), last);
  title.textContent = 'Your message for the developer';
  modal.hidden = false;
  bizEl('send-done').focus();
  void copyNoteText(text, () => bizSelect(pre)).then((ok) => {
    title.textContent = ok ? 'Copied — paste it to the developer' : 'Copy this text, then paste it to the developer';
    hint.textContent = ok ? 'This text is on your clipboard. Paste it into the chat or ticket where the developer works.' : 'Press Cmd+C (Ctrl+C) to copy it.';
  });
}

interface BizPage {
  cards: HTMLElement[];
  s: BizState;
  key: string;
  send: HTMLButtonElement;
}

const bizCard = (p: BizPage, id: string): HTMLElement => p.cards.find((c) => c.dataset.item === id)!;
const bizBox = (p: BizPage, id: string): HTMLElement | null => bizCard(p, id).querySelector<HTMLElement>('[data-cbox]');

function bizView(p: BizPage, c: HTMLElement): void {
  const id = c.dataset.item!;
  const btn = c.querySelector<HTMLElement>('[data-cbtn]');
  if (!btn) return;
  const open = bizBox(p, id)!.classList.contains('open');
  const text = (p.s.note[id] ?? '').trim();
  const preview = !open && !!text;
  btn.firstElementChild!.textContent = open ? 'Done' : text ? 'Edit note' : 'Add a note';
  btn.classList.toggle('on', open);
  btn.classList.toggle('has', preview);
  btn.setAttribute('aria-expanded', String(open));
  c.querySelector<HTMLElement>('[data-crm]')!.hidden = !preview;
  c.querySelector<HTMLElement>('[data-cview]')!.hidden = !preview;
  const shown = c.querySelector<HTMLElement>('[data-cprev]')!;
  shown.title = text;
  shown.lastElementChild!.textContent = text;
}

function bizRefresh(p: BizPage): void {
  const n = bizNotes(p.s).length;
  bizEl('note-count').textContent = String(n);
  bizEl('note-label').textContent = n === 1 ? 'answer or note' : 'answers and notes';
  p.send.disabled = n === 0;
  for (const c of p.cards) {
    const id = c.dataset.item!;
    c.querySelectorAll('[data-verdict]').forEach((b) => b.setAttribute('aria-pressed', String(p.s.verdict[id] === (b as HTMLElement).dataset.verdict)));
    bizView(p, c);
  }
  save(p.key, JSON.stringify(p.s));
}

function bizToggle(p: BizPage, id: string, open: boolean): void {
  const b = bizBox(p, id);
  if (!b) return;
  b.classList.toggle('open', open);
  bizRefresh(p);
  const area = b.querySelector('textarea')!;
  if (!open) return;
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);
}

function bizRemove(p: BizPage, id: string): void {
  const c = bizCard(p, id);
  delete p.s.note[id];
  c.querySelector<HTMLTextAreaElement>('[data-note]')!.value = '';
  bizRefresh(p);
  c.querySelector<HTMLElement>('[data-cbtn]')!.focus();
}

/** Puts the saved words back in their boxes; a note shows closed, as a preview. */
function bizRestore(p: BizPage): void {
  for (const c of p.cards) {
    const id = c.dataset.item!;
    const note = c.querySelector<HTMLTextAreaElement>('[data-note]');
    const answer = c.querySelector<HTMLTextAreaElement>('[data-answer]');
    if (note) note.value = p.s.note[id] ?? '';
    if (answer) answer.value = p.s.answer[id] ?? '';
  }
}

function bizNoteClick(p: BizPage, t: Element): boolean {
  const cbtn = t.closest<HTMLElement>('[data-cbtn]');
  if (cbtn) bizToggle(p, cbtn.dataset.cbtn!, !bizBox(p, cbtn.dataset.cbtn!)!.classList.contains('open'));
  const prev = t.closest<HTMLElement>('[data-cprev]');
  if (prev) bizToggle(p, prev.dataset.cprev!, true);
  const rm = t.closest<HTMLElement>('[data-crm]');
  if (rm) bizRemove(p, rm.dataset.crm!);
  return !!(cbtn || prev || rm);
}

function bizJump(t: Element): void {
  const jump = t.closest<HTMLAnchorElement>('a[data-jump]');
  const target = jump && document.getElementById(jump.getAttribute('href')!.slice(1));
  if (target) {
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
  }
}

function bizClick(p: BizPage, t: Element): void {
  if (bizNoteClick(p, t)) return;
  const verdict = t.closest<HTMLElement>('[data-verdict]');
  if (verdict) {
    const id = verdict.closest<HTMLElement>('[data-item]')!.dataset.item!;
    const val = verdict.dataset.verdict as Verdict;
    if (p.s.verdict[id] === val) delete p.s.verdict[id];
    else p.s.verdict[id] = val;
    bizRefresh(p);
    if (val === 'no' && p.s.verdict[id]) bizToggle(p, id, true);
    return;
  }
  bizJump(t);
}

function bizDialog(p: BizPage, change: Change): void {
  const modal = bizEl('send-modal');
  const close = () => {
    modal.hidden = true;
    p.send.focus();
  };
  p.send.addEventListener('click', () => bizSend(p.s, change));
  bizEl('send-copy').addEventListener('click', () => void copyNoteText(bizEl('send-text').textContent!, () => bizSelect(bizEl('send-text'))));
  bizEl('send-done').addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });
}

/** The business page: answers, Yes / No on the agent's readings, and notes, kept in localStorage; "Send back" turns them into the message `codechart feedback --import` reads. */
export function initBusiness(repo: string, change: Change = { slug: 'business', branch: '', at: '' }): void {
  if (!document.getElementById('send')) {
    // A read-only explain page has no notes, answers or bar; only the "About" links work.
    window.addEventListener('click', (e) => bizJump(e.target as Element));
    return;
  }
  const cards = bizCards();
  const key = `codechart.business:${repo}:${change.slug}:${change.at}`;
  const p: BizPage = { cards, s: bizSaved(key, new Set(cards.map((c) => c.dataset.item!))), key, send: bizEl<HTMLButtonElement>('send') };
  bizRestore(p);
  window.addEventListener('click', (e) => bizClick(p, e.target as Element));
  window.addEventListener('input', (e) => {
    const t = e.target as HTMLTextAreaElement;
    if (t.dataset.note) p.s.note[t.dataset.note] = t.value;
    if (t.dataset.answer) p.s.answer[t.dataset.answer] = t.value;
    bizRefresh(p);
  });
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (e.key !== 'Escape' || !t.dataset?.note) return;
    bizToggle(p, t.dataset.note, false);
    bizCard(p, t.dataset.note).querySelector<HTMLElement>('[data-cbtn]')!.focus();
  });
  bizDialog(p, change);
  bizRefresh(p);
}
