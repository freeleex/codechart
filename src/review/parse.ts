import { sanitizeText } from '../render/strip.js';
import { lastNoteNumber, nodeOfHeading } from './doc.js';
import type { Note, NoteKind, Review, ReviewNode } from './schema.js';

export interface Parsed {
  notes: Note[];
  warnings: string[];
}

const NOTE = /^>(\?|del(?=\s|$))?\s*(.*)$/;
const ROW = /^([ +-]) *(\d+)(?: {2}(.*))?$/;
const KIND: Record<string, NoteKind> = { '': 'comment', '?': 'question', del: 'delete' };

const sameNote = (a: Note, b: Note): boolean =>
  a.node === b.node && a.kind === b.kind && a.body === b.body && a.anchor?.line === b.anchor?.line && a.anchor?.side === b.anchor?.side;

/** The pending notes the document holds; one equal to an existing pending note is that note. */
export function parseDoc(text: string, review: Review, now: Date): Parsed {
  const warnings: string[] = [];
  const notes: Note[] = [];
  const existing = review.notes.filter((n) => n.state === 'pending');
  let next = lastNoteNumber(review.notes);
  let node: ReviewNode | undefined;
  let anchor: Note['anchor'];
  text.split('\n').forEach((raw, i) => {
    const at = `Line ${i + 1}`;
    if (raw.startsWith('## ')) {
      node = nodeOfHeading(raw, review.nodes);
      anchor = undefined;
      if (!node) warnings.push(`${at}: unknown node heading, so its notes were skipped`);
      return;
    }
    if (raw.startsWith('@@')) {
      anchor = undefined;
      return;
    }
    const m = NOTE.exec(raw);
    if (!m) {
      const r = node && ROW.exec(raw);
      if (r && node) anchor = { path: node.path ?? '', side: r[1] === '-' ? 'old' : 'new', line: Number(r[2]), text: r[3] ?? '' };
      return;
    }
    const body = sanitizeText(m[2]!).trim();
    if (!body) return;
    if (!node) {
      warnings.push(`${at}: this note isn't under a node, so it was skipped`);
      return;
    }
    const note: Note = { id: '', node: node.id, ...(node.rev && { rev: node.rev }), ...(anchor && { anchor }), kind: KIND[m[1] ?? '']!, body, state: 'pending', at: now.toISOString() };
    const same = existing.find((e) => sameNote(e, note) && !notes.includes(e));
    notes.push(same ?? { ...note, id: `n${++next}` });
  });
  return { notes, warnings };
}
