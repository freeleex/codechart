// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.
import type { Comments } from './comments.js';
import type { Change, Note } from './note-store.js';
import { cmEl } from './note-view.js';
import { KIND_LABEL, placeText, type NoteTarget } from './targets.js';

const countOf = (n: number) => `${n} note${n === 1 ? '' : 's'}`;

/** What the importer reads back, besides the note words above it: the places and kinds as base64url of UTF-8 JSON, no padding. */
function noteToken(change: Change, notes: Note[]): string {
  const json = JSON.stringify({ v: 1, slug: change.slug, branch: change.branch, at: change.at, notes: notes.map((n) => ({ t: n.t, ...(n.r !== undefined && { r: n.r }), k: n.k })) });
  let binary = '';
  new TextEncoder().encode(json).forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The notes as plain lines for the agent chat, then a closing line with the token. */
export function finishMessage(title: string, change: Change, notes: Note[], place: (t: NoteTarget) => string = placeText, count: (n: number) => string = countOf): string {
  const lines = notes.map((n, i) => `${i + 1}. On ${place(n.t)}: ${KIND_LABEL[n.k]}${n.b.trim() ? `: ${n.b.trim().replace(/\n/g, '\n   ')}` : ''}`);
  return `Review done: ${count(notes.length)} on "${title}".\n${lines.join('\n')}\n\ncodechart review · ${countOf(notes.length)} · ${noteToken(change, notes)}`;
}

/** A message over this is split into batches; tests keep it under the importer's cap. */
export const FINISH_LIMIT = 448 * 1024;

/** The most unsent notes, from the first, whose message stays under FINISH_LIMIT; always at least one. */
function fitBatch(title: string, change: Change, notes: Note[]): { text: string; count: number } {
  const size = (n: number) => new TextEncoder().encode(finishMessage(title, change, notes.slice(0, n))).length;
  let lo = 1;
  let hi = notes.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (size(mid) <= FINISH_LIMIT) lo = mid;
    else hi = mid - 1;
  }
  return { text: finishMessage(title, change, notes.slice(0, lo)), count: lo };
}

/** `select` shows the text selected for a manual copy when the clipboard is blocked. */
export async function copyNoteText(text: string, select: () => void): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    select();
  }
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  }
}

interface FinishDialog {
  modal: HTMLElement;
  preview: HTMLTextAreaElement;
  hint: HTMLElement;
  copy: HTMLButtonElement;
  cancel: HTMLButtonElement;
}

function finishDialog(text: string, partial?: string): FinishDialog {
  const dialog = cmEl('div', 'cm-dialog');
  dialog.id = 'finish-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Finish review');
  const preview = cmEl('textarea', 'cm-preview');
  preview.readOnly = true;
  preview.rows = 10;
  preview.value = text;
  preview.setAttribute('aria-label', 'Message for the agent');
  const hint = cmEl('p', 'cm-hint', 'Press Cmd+C (Ctrl+C) to copy.');
  hint.hidden = true;
  const alt = cmEl('p', 'cm-alt', 'Or run ');
  alt.append(cmEl('code', '', 'codechart feedback --import'), ' in a terminal.');
  const copy = cmEl('button', 'cm-copy', 'Copy and close');
  const cancel = cmEl('button', 'cm-cancel', 'Cancel');
  copy.type = cancel.type = 'button';
  const actions = cmEl('div', 'cm-actions');
  actions.append(copy, cancel);
  dialog.append(cmEl('h2', '', 'Finish review'), cmEl('p', '', 'Copy this and paste it into your agent chat.'));
  if (partial) dialog.append(cmEl('p', 'cm-part', partial));
  dialog.append(preview, hint, actions, alt);
  const modal = cmEl('div', 'cm-modal');
  modal.append(dialog);
  return { modal, preview, hint, copy, cancel };
}

/** Esc closes; Tab stays among the popup's own controls. */
function trapKeys(d: FinishDialog, close: () => void): void {
  const stops = [d.preview, d.copy, d.cancel];
  d.modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      const at = stops.findIndex((s) => s === document.activeElement);
      e.preventDefault();
      stops[e.shiftKey ? (at <= 0 ? stops.length : at) - 1 : (at + 1) % stops.length]!.focus();
    }
  });
  d.modal.addEventListener('click', (e) => {
    if (e.target === d.modal) close();
  });
  d.cancel.addEventListener('click', close);
}

function toast(text: string): void {
  const t = cmEl('div', 'cm-toast', text);
  t.setAttribute('role', 'status');
  document.body.append(t);
  setTimeout(() => t.remove(), 2500);
}

/** The popup: the message to copy. A copy that worked marks its notes sent; one that failed leaves the text selected. */
function openFinish(comments: Comments, change: Change, opener: HTMLElement): void {
  const list = comments.unsent();
  if (!list.length) return;
  const { text, count } = fitBatch(document.querySelector('header h1')!.textContent!, change, list);
  const batch = list.slice(0, count);
  const d = finishDialog(text, count < list.length ? `This message has ${count} of ${countOf(list.length)}. Paste it, then click Finish review again for the rest.` : undefined);
  const close = () => {
    d.modal.remove();
    opener.focus();
  };
  trapKeys(d, close);
  d.copy.addEventListener('click', async () => {
    if (await copyNoteText(text, () => {
      d.preview.focus();
      d.preview.select();
    })) {
      close();
      comments.markSent(batch.map((n) => n.id));
      toast('Copied');
      return;
    }
    d.preview.focus();
    d.preview.select();
    d.hint.hidden = false;
  });
  document.body.append(d.modal);
  d.copy.focus();
}

/** The "Finish review" button at the top right of the header; it opens the popup. */
export function initFinish(comments: Comments, change: Change): void {
  const button = cmEl('button', '');
  button.id = 'finish-review';
  button.type = 'button';
  button.title = 'Copy your notes to paste into the agent chat';
  document.querySelector('header')!.append(button);
  comments.onChange(() => {
    const n = comments.unsent().length;
    button.textContent = `Finish review (${n})`;
    button.hidden = n === 0;
  });
  button.addEventListener('click', () => openFinish(comments, change, button));
}
