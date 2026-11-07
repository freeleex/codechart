import type { Note, Review, ReviewNode, Target } from './schema.js';

/** What a map shows besides its nodes, for the notes that target it. */
export type Lists = Pick<Review, 'drift' | 'edges' | 'gaps' | 'omitted'>;

/** Whether the new render still has what a note targets: a drift item with the same id and kind, an arrow, or a gap or not-on-map item with the same text. */
export function targetExists(target: Target, lists: Lists): boolean {
  switch (target.type) {
    case 'drift':
      return (lists.drift ?? []).some((d) => d.id === target.id && d.kind === target.kind);
    case 'edge':
      return (lists.edges ?? []).some((e) => e.from === target.from && e.to === target.to && e.label === target.label);
    case 'gap':
      return (lists.gaps ?? []).includes(target.text);
    case 'omitted':
      return (lists.omitted ?? []).includes(target.text);
    case 'title':
      return true;
  }
}

/**
 * The notes of the previous render of a change, for the new one. A note stays where its node (by id, else by
 * path) still has the same diff; if the diff differs or no node matches, it turns outdated. A note never moves to another line.
 * A note on a plan-vs-built item, arrow, gap or not-on-map item stays while the new render still has it; one on the title always stays.
 */
export function carryNotes(prev: Review, nodes: ReviewNode[], lists: Lists = {}): Note[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const oldPath = new Map(prev.nodes.map((n) => [n.id, n.path]));
  return prev.notes.map((note) => {
    if (note.target) return note.state === 'pending' && !targetExists(note.target, lists) ? { ...note, state: 'outdated' } : note;
    const direct = byId.get(note.node ?? '');
    const path = oldPath.get(note.node ?? '');
    const node = direct ?? (path !== undefined ? nodes.find((n) => n.path === path) : undefined);
    if (!node) return note.state === 'sent' ? note : { ...note, state: 'outdated' };
    const moved = { ...note, node: node.id };
    if (note.state !== 'pending') return moved;
    return node.rev === note.rev ? moved : { ...moved, state: 'outdated' };
  });
}
