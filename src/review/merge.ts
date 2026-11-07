import { carryNotes } from './carry.js';
import { lastNoteNumber } from './doc.js';
import type { Note, Review } from './schema.js';

/**
 * The notes to save into `fresh`, the review as it is now, for the `parsed` ones written against `opened`, the review the editor was opened on.
 * Notes pending at open are replaced by the parsed ones (carried onto fresh's nodes as a re-render would); one that was sent meanwhile stays sent;
 * a note added meanwhile stays.
 */
export function mergeNotes(opened: Review, parsed: Note[], fresh: Review): Note[] {
  // A note on a drift item, arrow, gap or the title is not in the editor: it stays as it is.
  const wasPending = new Set(opened.notes.filter((n) => n.state === 'pending' && !n.target).map((n) => n.id));
  const freshState = new Map(fresh.notes.map((n) => [n.id, n.state]));
  const kept = fresh.notes.filter((n) => !(wasPending.has(n.id) && n.state !== 'sent'));
  const carried = carryNotes({ ...opened, notes: parsed }, fresh.nodes, fresh).filter((n) => !(wasPending.has(n.id) && freshState.get(n.id) === 'sent'));
  let next = lastNoteNumber([...fresh.notes, ...carried.filter((n) => wasPending.has(n.id))]);
  return [...kept, ...carried.map((n) => (wasPending.has(n.id) ? n : { ...n, id: `n${++next}` }))];
}
