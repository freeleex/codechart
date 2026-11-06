import type { Note, Review, ReviewNode } from './schema.js';

/**
 * The notes of the previous render of a change, for the new one. A note stays where its node (by id, else by
 * path) still has the same diff; if the diff differs or no node matches, it turns outdated. A note never moves to another line.
 */
export function carryNotes(prev: Review, nodes: ReviewNode[]): Note[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const oldPath = new Map(prev.nodes.map((n) => [n.id, n.path]));
  return prev.notes.map((note) => {
    const direct = byId.get(note.node);
    const path = oldPath.get(note.node);
    const node = direct ?? (path !== undefined ? nodes.find((n) => n.path === path) : undefined);
    if (!node) return note.state === 'sent' ? note : { ...note, state: 'outdated' };
    const moved = { ...note, node: node.id };
    if (note.state !== 'pending') return moved;
    return node.rev === note.rev ? moved : { ...moved, state: 'outdated' };
  });
}
