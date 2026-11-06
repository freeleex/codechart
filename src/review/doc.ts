import { sanitizeText } from '../render/strip.js';
import type { DiffLine, Note, NoteKind, Review, ReviewNode } from './schema.js';

const NOTE_MARK: Record<NoteKind, string> = { comment: '>', question: '>?', delete: '>del' };

/** The highest `n<number>` note id, so a new note takes the next. */
export const lastNoteNumber = (notes: Note[]): number => Math.max(0, ...notes.map((n) => Number(/^n(\d+)$/.exec(n.id)?.[1] ?? 0)));

/** The map's title, or the file name slug for a review file written before titles were kept. */
export const changeTitle = (review: Review): string => review.change.title ?? review.change.slug;

/** A label or path on one line, so a heading is always one line. */
export const oneLine = (s: string): string => s.replace(/\s*[\r\n\t]+\s*/g, ' ');

/** Label and path first; the id last, in brackets, is what the parser and the agent use. */
const nodeHeader = (n: ReviewNode): string => `## ${oneLine(n.label)}${n.path ? ` — ${oneLine(n.path)}` : ''}  [${n.id}]`;

/** The node a heading line names: new form `## label — path  [id]`, or the older `## [id] label`. */
export const nodeOfHeading = (raw: string, nodes: ReviewNode[]): ReviewNode | undefined =>
  nodes
    .filter((n) => raw.endsWith(`  [${n.id}]`) || raw === `## [${n.id}]` || raw.startsWith(`## [${n.id}] `))
    .sort((a, b) => b.id.length - a.id.length)[0];

const hhmm = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const HEAD = [
  '# Add a note on its own line under a node or a diff line:',
  '#   > text    comment        >? text   question       >del text  delete this',
  '# Lines starting with # are ignored. Save and quit when you are done; quit without saving to cancel.',
];

/** The note's diff line: a new-side line for add/ctx, an old-side one for del. */
export const isAt = (l: DiffLine, side: 'old' | 'new', line: number): boolean =>
  l.n === line && (side === 'old' ? l.kind === 'del' : l.kind === 'add' || l.kind === 'ctx');

function noteText(n: Note): string {
  if (n.state === 'pending') return `${NOTE_MARK[n.kind]} ${n.body}`;
  return `# ${n.state === 'sent' ? 'Already sent to your agent' : 'Outdated, the code changed'} (${n.kind}): ${n.body}`;
}

function row(l: DiffLine, width: number): string {
  if (l.kind === 'hunk') return l.text;
  const sign = l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' ';
  return `${sign}${String(l.n ?? 0).padStart(width)}  ${l.text}`;
}

const hasDiff = (n: ReviewNode): boolean => (n.lines?.length ?? 0) > 0 || n.note !== undefined;

/** `seen`: the diffs already printed, by file and lines; a second node on the same diff points back instead of repeating it. */
function nodeBlock(node: ReviewNode, notes: Note[], width: number, seen: Map<string, string>): string[] {
  const out = ['', nodeHeader(node)];
  if (node.note) out.push(`# ${node.note}`);
  const lines = node.lines ?? [];
  const key = node.path && lines.length ? `${node.path}\n${JSON.stringify(lines)}` : undefined;
  // A node with notes on its lines prints its rows: the notes' anchors need them.
  const anchored = notes.some((n) => n.state === 'pending' && n.anchor);
  const first = key && !anchored ? seen.get(key) : undefined;
  if (key && first === undefined && !anchored) seen.set(key, node.label);
  if (first !== undefined) return [...out, `# Same diff as "${oneLine(first)}" above.`, ...notes.map(noteText)];
  const placed = (n: Note) => n.anchor !== undefined && lines.some((l) => isAt(l, n.anchor!.side, n.anchor!.line));
  out.push(...notes.filter((n) => !placed(n)).map(noteText));
  for (const l of lines) {
    out.push(row(l, width));
    out.push(...notes.filter((n) => n.anchor && isAt(l, n.anchor.side, n.anchor.line)).map(noteText));
  }
  return out;
}

/** The text the editor opens: the nodes with a diff first, each with the diff the map showed and the notes in place, then the unchanged ones. */
export function buildDoc(review: Review): string {
  const { change, nodes, notes } = review;
  const digits = Math.max(3, ...nodes.flatMap((n) => (n.lines ?? []).map((l) => String(l.n ?? 0).length)));
  const of = (n: ReviewNode) => notes.filter((x) => x.node === n.id);
  const branch = change.branch ? ` · branch ${change.branch}` : '';
  const out = [`# Review: ${oneLine(changeTitle(review))}${branch} · drawn at ${hhmm(change.renderedAt)}`, ...HEAD];
  const seen = new Map<string, string>();
  for (const node of nodes.filter(hasDiff)) out.push(...nodeBlock(node, of(node), digits, seen));
  const rest = nodes.filter((n) => !hasDiff(n));
  if (rest.length) {
    out.push('', '# Unchanged on the map (you can still note on them):');
    for (const node of rest) out.push(nodeHeader(node), ...of(node).map(noteText));
  }
  const ids = new Set(nodes.map((n) => n.id));
  const gone = notes.filter((n) => !ids.has(n.node));
  if (gone.length) out.push('', '# Notes on nodes the map no longer has:', ...gone.map((n) => `# ${n.state === 'sent' ? 'Sent' : 'Outdated'} (${n.kind}) on [${n.node}]: ${n.body}`));
  return sanitizeText(`${out.join('\n')}\n`);
}
