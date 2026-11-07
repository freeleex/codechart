import { z } from 'zod';
import { sanitizeText } from '../render/strip.js';
import { targetExists } from './carry.js';
import { isAt, lastNoteNumber } from './doc.js';
import { sameNote } from './parse.js';
import type { Note, Review, Target } from './schema.js';

export const MAX_IMPORT_BYTES = 512 * 1024;
const MAX_NOTES = 500;

const NO_REVIEW = 'No codechart review found. Copy it again with "Finish review" on the page.';
const DAMAGED = 'The codechart review is damaged; copy it again with "Finish review" on the page.';

const str = z.string().max(2000);
const target = z.union([
  z.strictObject({ node: str, path: str, side: z.enum(['old', 'new']), line: z.number().int().min(1) }),
  z.strictObject({ node: str }),
  z.strictObject({ drift: str, kind: z.enum(['missing', 'unplanned', 'different']) }),
  z.strictObject({ edge: z.strictObject({ from: str, to: str, label: str.optional() }) }),
  z.strictObject({ gap: str }),
  z.strictObject({ omitted: str }),
  z.strictObject({ title: z.literal(true) }),
]);

const payloadSchema = z.strictObject({
  v: z.literal(1),
  slug: str,
  branch: str,
  at: str,
  notes: z
    .array(z.strictObject({ t: target, r: str.optional(), k: z.enum(['comment', 'question', 'delete']), b: z.string().max(4000) }))
    .max(MAX_NOTES),
});

export type ImportPayload = z.infer<typeof payloadSchema>;

const MARKER = /^[\s>`]*codechart review ·/;

/**
 * The review a page copied: the text after the last `codechart review ·` line, minus whitespace, quote marks and fences, is a
 * base64url JSON token. Throws an Error in plain words when there is none or it is damaged.
 */
export function parseReviewText(text: string): ImportPayload {
  if (Buffer.byteLength(text) > MAX_IMPORT_BYTES) throw new Error('The pasted text is too long to be a codechart review (over 512 KB).');
  const lines = text.split(/\r\n?|\n/);
  const at = lines.map((l) => MARKER.test(l)).lastIndexOf(true);
  if (at < 0) throw new Error(NO_REVIEW);
  const rest = lines.slice(at).join('\n');
  const token = rest.slice(rest.lastIndexOf('·') + 1).replace(/[\s>`]/g, '');
  if (!/^[A-Za-z0-9_-]+$/.test(token)) throw new Error(DAMAGED);
  try {
    return payloadSchema.parse(JSON.parse(Buffer.from(token, 'base64url').toString('utf8')));
  } catch {
    throw new Error(DAMAGED);
  }
}

type Pasted = ImportPayload['notes'][number];

/** The saved target of a pasted one; `node` for the note's node field. */
function resolve(t: Pasted['t']): { node?: string; target?: Target } {
  if ('drift' in t) return { node: sanitizeText(t.drift), target: { type: 'drift', id: sanitizeText(t.drift), kind: t.kind } };
  if ('edge' in t) {
    const { from, to, label } = { from: sanitizeText(t.edge.from), to: sanitizeText(t.edge.to), label: t.edge.label && sanitizeText(t.edge.label) };
    return { node: from, target: { type: 'edge', from, to, ...(label && { label }) } };
  }
  if ('gap' in t) return { target: { type: 'gap', text: sanitizeText(t.gap) } };
  if ('omitted' in t) return { target: { type: 'omitted', text: sanitizeText(t.omitted) } };
  if ('title' in t) return { target: { type: 'title' } };
  return { node: sanitizeText(t.node) };
}

const clean = (s: string): string => sanitizeText(s).trim();

type Base = Pick<Note, 'id' | 'kind' | 'body' | 'at'>;

function targetNote(review: Review, base: Base, nodeId: string | undefined, tgt: Target): Note {
  const isNode = tgt.type === 'drift' && review.nodes.some((n) => n.id === nodeId);
  return { ...base, ...(nodeId && (isNode || tgt.type === 'edge') && { node: nodeId }), target: tgt, state: targetExists(tgt, review) ? 'pending' : 'outdated' };
}

function nodeNote(review: Review, base: Base, nodeId: string | undefined, p: Pasted): Note {
  const node = review.nodes.find((n) => n.id === nodeId);
  const rev = p.r === undefined ? {} : { rev: p.r };
  const at = 'line' in p.t ? p.t : undefined;
  if (!node) return { ...base, node: nodeId, ...rev, ...(at && { anchor: { path: clean(at.path), side: at.side, line: at.line, text: '' } }), state: 'outdated' };
  const hit = at && node.lines?.find((l) => isAt(l, at.side, at.line));
  const anchor = at && { path: node.path ?? clean(at.path), side: at.side, line: at.line, text: hit?.text ?? '' };
  const fresh = p.r === node.rev && (!at || hit !== undefined);
  return { ...base, node: node.id, ...rev, ...(anchor && { anchor }), state: fresh ? 'pending' : 'outdated' };
}

function build(review: Review, p: Pasted, id: string, now: Date): Note | undefined {
  const body = clean(p.b);
  if (!body) return undefined;
  const { node, target: tgt } = resolve(p.t);
  const base = { id, kind: p.k, body, at: now.toISOString() };
  return tgt ? targetNote(review, base, node, tgt) : nodeNote(review, base, node, p);
}

/** `review` with the pasted notes added; one equal to a note already there, in any state, is not added twice. Counts: `added`, of which `outdated` (what the map changed since the page was drawn). */
export function importNotes(review: Review, payload: ImportPayload, now: Date): { review: Review; added: number; outdated: number } {
  const notes = [...review.notes];
  let next = lastNoteNumber(notes);
  let outdated = 0;
  let added = 0;
  for (const p of payload.notes) {
    const note = build(review, p, `n${next + 1}`, now);
    if (!note || notes.some((n) => sameNote(n, note))) continue;
    next++;
    added++;
    if (note.state === 'outdated') outdated++;
    notes.push(note);
  }
  return { review: added ? { ...review, notes } : review, added, outdated };
}
