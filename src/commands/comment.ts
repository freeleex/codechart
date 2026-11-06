import { Command, Option } from 'commander';
import type { CommandOptions } from '../program.js';
import { sanitizeText } from '../render/strip.js';
import { isAt, lastNoteNumber } from '../review/doc.js';
import type { Note, NoteKind, Review, ReviewNode } from '../review/schema.js';
import { updateReview } from '../review/store.js';
import { guarded, locateChange } from './review-shared.js';

interface CommentFlags {
  kind: NoteKind;
  side?: 'old' | 'new';
  change?: string;
}

/** `node`, `node:line` or `node:path:line`; the longest node id that starts the argument wins. */
function resolveTarget(review: Review, arg: string): { node: ReviewNode; line?: number } {
  const exact = review.nodes.find((n) => n.id === arg);
  if (exact) return { node: exact };
  const m = /^(.+):(\d+)$/.exec(arg);
  const head = m?.[1] ?? arg;
  const node = review.nodes.filter((n) => head === n.id || head.startsWith(`${n.id}:`)).sort((a, b) => b.id.length - a.id.length)[0];
  if (!node) throw new Error(`No node with the id "${arg}" on this map. Nodes: ${review.nodes.map((n) => `${n.label} [${n.id}]`).join(', ')}.`);
  const path = head.slice(node.id.length + 1);
  if (!m) throw new Error(`Give the node id, or id:line, or id:path:line (got "${arg}").`);
  if (path && path !== node.path) throw new Error(`"${node.label}" is ${node.path ?? 'not a file'}, not ${path}.`);
  return { node, line: Number(m[2]) };
}

function anchorOf(node: ReviewNode, line: number, side?: 'old' | 'new'): NonNullable<Note['anchor']> {
  const lines = node.lines ?? [];
  const at = side ?? (!lines.some((l) => isAt(l, 'new', line)) && lines.some((l) => isAt(l, 'old', line)) ? 'old' : 'new');
  const hit = lines.find((l) => isAt(l, at, line));
  if (!hit) throw new Error(`Line ${line} (${at} side) is not in the diff shown for "${node.label}".`);
  return { path: node.path ?? '', side: at, line, text: hit.text };
}

function comment(target: string, words: string[], o: CommentFlags, opts: CommandOptions): void {
  const { file } = locateChange(opts, o.change);
  const body = sanitizeText(words.join(' ')).replace(/\s*\n\s*/g, ' ').trim();
  if (!body) throw new Error('The note is empty.');
  let added: { node: ReviewNode; anchor?: Note['anchor'] } | undefined;
  updateReview(file, (review) => {
    const { node, line } = resolveTarget(review, target);
    const anchor = line === undefined ? undefined : anchorOf(node, line, o.side);
    added = { node, anchor };
    const note: Note = {
      id: `n${lastNoteNumber(review.notes) + 1}`,
      node: node.id,
      ...(node.rev && { rev: node.rev }),
      ...(anchor && { anchor }),
      kind: o.kind,
      body,
      state: 'pending',
      at: (opts.now?.() ?? new Date()).toISOString(),
    };
    return { ...review, notes: [...review.notes, note] };
  });
  const { node, anchor } = added!;
  const place = anchor ? `${node.path}:${anchor.line}` : node.path;
  opts.stdout(sanitizeText(`✔ ${o.kind[0]!.toUpperCase()}${o.kind.slice(1)} added to "${node.label}"${place ? ` (${place})` : ''}\n`));
}

export function commentCommand(opts: CommandOptions): Command {
  return new Command('comment')
    .description('add one review note to a node of the latest map')
    .argument('<target>', 'node id, optionally with :<path>:<line> or :<line> of a line in its diff')
    .argument('<text...>', 'the note')
    .addOption(new Option('--kind <kind>', 'comment, question or delete').choices(['comment', 'question', 'delete']).default('comment'))
    .addOption(new Option('--side <side>', 'with a line: the old (removed) or new (added) side; default new').choices(['old', 'new']))
    .option('--change <title>', 'the map with this title (or file name slug), instead of the newest one on this branch')
    .action((target: string, words: string[], o: CommentFlags) => guarded(opts, () => comment(target, words, o, opts)));
}
