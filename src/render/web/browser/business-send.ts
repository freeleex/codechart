// Runs in the generated business page; scripts/client-build.ts puts it ahead of business.ts in the one inline script.
import { copyNoteText } from './finish.js';

const el = (id: string): HTMLElement => document.getElementById(id)!;

const sent = { parts: [] as string[], at: 0 };

/** Shows one message with its closing token line marked, and copies it. A long reply comes as several, each importable alone. */
function showPart(select: (pre: HTMLElement) => void): void {
  const text = sent.parts[sent.at]!;
  const many = sent.parts.length > 1;
  const pre = el('send-text');
  const cut = text.lastIndexOf('\n\ncodechart review ·') + 2;
  const tip = "Code that tells the developer's tool which page this is";
  const last = document.createElement('span');
  last.id = 'send-token';
  last.title = tip;
  last.setAttribute('aria-label', tip);
  last.textContent = text.slice(cut);
  pre.replaceChildren(text.slice(0, cut), last);
  const more = sent.at < sent.parts.length - 1;
  el('send-part').hidden = !many;
  el('send-part').textContent = `Message ${sent.at + 1} of ${sent.parts.length}. ${more ? 'Paste it, then click Next part for the rest.' : 'This is the last one.'}`;
  el('send-next').hidden = !more;
  el('send-title').textContent = 'Your message for the developer';
  void copyNoteText(text, () => select(pre)).then((ok) => {
    const part = many ? ` message ${sent.at + 1}` : '';
    el('send-title').textContent = ok ? `Copied${part} — paste it to the developer` : 'Copy this text, then paste it to the developer';
    el('send-hint').textContent = ok ? 'This text is on your clipboard. Paste it into the chat or ticket where the developer works.' : 'Press Cmd+C (Ctrl+C) to copy it.';
  });
}

/** Opens the dialog on the first message. */
export function openSend(parts: string[], select: (pre: HTMLElement) => void): void {
  sent.parts = parts;
  sent.at = 0;
  el('send-modal').hidden = false;
  el('send-done').focus();
  showPart(select);
}

/** The next message of a long reply. */
export function stepSend(select: (pre: HTMLElement) => void): void {
  if (sent.at >= sent.parts.length - 1) return;
  sent.at++;
  showPart(select);
}
