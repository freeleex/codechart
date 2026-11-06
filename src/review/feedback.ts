import { sanitizeText } from '../render/strip.js';
import { changeTitle, oneLine } from './doc.js';
import type { Note, NoteKind, Review } from './schema.js';

const LABEL: Record<NoteKind, string> = { comment: 'Comment', question: 'Question', delete: 'Delete' };

const pending = (review: Review): Note[] => review.notes.filter((n) => n.state === 'pending');

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The pending notes as numbered markdown for an agent, or undefined when there are none. */
export function feedbackText(review: Review): string | undefined {
  const notes = pending(review);
  if (!notes.length) return undefined;
  const items = notes.map((n, i) => {
    const node = review.nodes.find((x) => x.id === n.node);
    const path = oneLine(n.anchor?.path || node?.path || '');
    const place = n.anchor ? `${path ? `${path}:` : 'line '}${n.anchor.line}, ${n.anchor.side} line` : path;
    const quote = n.anchor ? `\n   > ${n.anchor.text}` : '';
    return `${i + 1}. ${oneLine(node?.label ?? n.node)}${place ? ` (${place})` : ''}  [${n.node}]${quote}\n   ${LABEL[n.kind]}: ${n.body.replace(/\n/g, '\n   ')}`;
  });
  return sanitizeText(`# Review feedback: ${oneLine(changeTitle(review))} (${plural(notes.length, 'note')})\n\n${items.join('\n\n')}\n`);
}

/** `N notes saved — X comments · Y questions · Z deletes` */
export function countsLine(review: Review): string {
  const notes = pending(review);
  const n = (kind: NoteKind) => notes.filter((x) => x.kind === kind).length;
  return `${plural(notes.length, 'note')} saved — ${plural(n('comment'), 'comment')} · ${plural(n('question'), 'question')} · ${plural(n('delete'), 'delete')}`;
}

/** Terminals that support it put the text on the clipboard. */
export const osc52 = (text: string): string => `\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`;
