// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.

type MapKind = 'comment' | 'question' | 'delete';
export type NoteKind = MapKind | 'answer' | 'confirm' | 'reject';
type DriftKindName = 'missing' | 'unplanned' | 'different';
export type NoteTarget =
  | { node: string }
  | { node: string; path: string; side: 'old' | 'new'; line: number }
  | { drift: string; kind: DriftKindName }
  | { edge: { from: string; to: string; label?: string } }
  | { gap: string }
  | { omitted: string }
  | { title: true };

export const NOTE_KINDS: MapKind[] = ['comment', 'question', 'delete'];
export const KIND_LABEL: Record<NoteKind, string> = { comment: 'Comment', question: 'Question', delete: 'Delete', answer: 'Answer', confirm: 'Confirmed', reject: 'Rejected' };
const DRIFT_WORDS: Record<DriftKindName, string> = { missing: 'not built', unplanned: 'built, not in the plan', different: 'built differently' };

export const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function nodeTargetOf(v: Record<string, unknown> & { node: string }): NoteTarget | null {
  if (v.path === undefined && v.side === undefined && v.line === undefined) return { node: v.node };
  return isStr(v.path) && (v.side === 'old' || v.side === 'new') && Number.isInteger(v.line) && (v.line as number) > 0 ? { node: v.node, path: v.path, side: v.side, line: v.line as number } : null;
}

function edgeTargetOf(e: Record<string, unknown>): NoteTarget | null {
  if (!isStr(e.from) || !isStr(e.to) || (e.label !== undefined && typeof e.label !== 'string')) return null;
  return { edge: { from: e.from, to: e.to, ...(e.label !== undefined && { label: e.label }) } };
}

/** The target as the page and the hand-off message define it, or null for anything else. */
export function validTarget(v: unknown): NoteTarget | null {
  if (!isObj(v)) return null;
  if (isStr(v.node)) return nodeTargetOf({ ...v, node: v.node });
  if (isStr(v.drift)) return v.kind === 'missing' || v.kind === 'unplanned' || v.kind === 'different' ? { drift: v.drift, kind: v.kind } : null;
  if (isObj(v.edge)) return edgeTargetOf(v.edge);
  if (isStr(v.gap)) return { gap: v.gap };
  if (isStr(v.omitted)) return { omitted: v.omitted };
  return v.title === true ? { title: true } : null;
}

export const targetKey = (t: NoteTarget): string => JSON.stringify(t);

/** The node a target belongs to, if it is on one. */
export const nodeOfTarget = (t: NoteTarget): string | undefined => ('node' in t ? t.node : 'drift' in t ? t.drift : undefined);

function nodeLabel(id: string): string {
  const g = [...document.querySelectorAll('.node')].find((n) => n.getAttribute('data-id') === id);
  const label = g?.getAttribute('data-label') ?? id;
  const flow = g?.closest('[data-title]')?.getAttribute('data-title');
  return flow ? `${flow}: ${label}` : label;
}

function placeWords(t: NoteTarget): string {
  if ('path' in t) return `line ${t.line} of ${t.path} (${t.side})`;
  if ('node' in t) return nodeLabel(t.node);
  if ('drift' in t) return `the plan-vs-built note of ${nodeLabel(t.drift)} (${DRIFT_WORDS[t.kind]})`;
  if ('edge' in t) return `the arrow ${nodeLabel(t.edge.from)} → ${nodeLabel(t.edge.to)}${t.edge.label ? ` (“${t.edge.label}”)` : ''}`;
  if ('gap' in t) return `the gap “${t.gap}”`;
  if ('omitted' in t) return `the not-on-map item “${t.omitted}”`;
  return 'the title';
}

/** The page's own text for a place, e.g. "line 13 of shop/models/order.py (new)". A ": " inside would be read as the end of the place, so it becomes a dash. */
export const placeText = (t: NoteTarget): string => placeWords(t).replace(/: /g, ' – ');

/** The diff line a click on a row's number means: file from the panel's heading, side from the row's colour. */
export function lineTarget(row: Element, nodeId: string): NoteTarget | null {
  const n = Number(row.querySelector('.ln')?.textContent);
  const path = row.closest('#panel')?.querySelector('.ch-path')?.textContent;
  if (!Number.isInteger(n) || n < 1 || !path) return null;
  return { node: nodeId, path, side: row.classList.contains('d-del') ? 'old' : 'new', line: n };
}

/** The target an edge's note button stands for. */
export function edgeTarget(g: Element): NoteTarget {
  const label = [...g.children].find((c) => c.tagName.toLowerCase() === 'text')?.textContent;
  return { edge: { from: g.getAttribute('data-from')!, to: g.getAttribute('data-to')!, ...(label && { label }) } };
}
