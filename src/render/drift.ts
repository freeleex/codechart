import type { DriftCause } from '../spec/shared.js';

export type DriftKind = 'missing' | 'unplanned' | 'different';

/** What the plan said to do, or what the build did. */
export type DriftChange = 'add' | 'change' | 'remove';

/** What users read for each kind and cause, in the terminal (lower-cased) and the page. */
export const KIND_PHRASE: Record<DriftKind, string> = { missing: 'In the plan, not built', unplanned: 'Built, not in the plan', different: 'Built differently' };
export const CAUSE_LABEL: Record<DriftCause, string> = {
  'bug-found': 'Found a bug',
  'wrong-assumption': 'Plan assumed wrong',
  'user-asked': 'You asked for it',
  'cleaner-way': 'Found a cleaner way',
  'out-of-scope': 'Left for later',
  other: 'Other',
};
export const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

export interface DriftItem<G> {
  /** The summary's id for the node or step when it has one, else the plan's. */
  id: string;
  /** The node's or step's label, without a status marker. */
  label: string;
  kind: DriftKind;
  /** What the item is, e.g. `service`, `file`, `step`. */
  noun: string;
  /** What the plan said to do (missing) or the build did (unplanned). */
  change?: DriftChange;
  /** What differs, e.g. `path a → b`. */
  detail?: string;
  /** The same differences as short sentences. */
  plain?: string[];
  /** What the plan had and the build has, where a difference has two values; names in backticks. */
  pairs?: Pair[];
  cause?: DriftCause;
  why?: string;
  /** The plan's node or step, for what was planned and has no match in the summary. */
  ghost?: G;
}

export interface Drift<G> {
  plan: { title: string; savedAt: string };
  items: DriftItem<G>[];
  /** Items without a reason in the summary's `drift`. */
  unexplained: number;
  /** Ids in `drift` that did not drift. */
  strayReasons: string[];
}

export interface DriftReason {
  id: string;
  cause: DriftCause;
  why: string;
}

/** Plan items matched to built ones: by id first, then by where they live (`sameSpot`); each built item pairs once. */
export function pairItems<T extends { id: string }>(plan: readonly T[], built: readonly T[], sameSpot: (plan: T, built: T) => boolean): Map<T, T> {
  const pairs = new Map<T, T>();
  const taken = new Set<T>();
  const byId = new Map(built.map((b) => [b.id, b]));
  const take = (p: T, b: T | undefined) => {
    if (!b) return;
    pairs.set(p, b);
    taken.add(b);
  };
  for (const p of plan) take(p, byId.get(p.id));
  for (const p of plan) if (!pairs.has(p)) take(p, built.find((b) => !taken.has(b) && sameSpot(p, b)));
  return pairs;
}

/** Items with their reasons joined by id; a reason may name the plan's id for something matched under another. */
export function withReasons<G>(
  plan: Drift<G>['plan'],
  items: DriftItem<G>[],
  reasons: readonly DriftReason[],
  renamed: ReadonlyMap<string, string>,
): Drift<G> {
  const byId = new Map(reasons.map((r) => [renamed.get(r.id) ?? r.id, r]));
  const used = new Set<string>();
  const joined = items.map((item) => {
    const r = byId.get(item.id);
    if (!r) return item;
    used.add(item.id);
    return { ...item, cause: r.cause, why: r.why };
  });
  return {
    plan,
    items: joined,
    unexplained: joined.filter((i) => i.cause === undefined).length,
    strayReasons: reasons.filter((r) => !used.has(renamed.get(r.id) ?? r.id)).map((r) => r.id),
  };
}

/** Adds what differs to a built item's entry; an item already missing or unplanned says enough. */
export function noteDifference<G>(items: Map<string, DriftItem<G>>, at: { id: string; label: string; noun: string }, note: Note): void {
  const item = items.get(at.id);
  if (!item) items.set(at.id, { ...at, kind: 'different', ...detailOf([note]) });
  else if (item.kind === 'different') {
    item.detail = `${item.detail}, ${note.text}`;
    item.plain = [...(item.plain ?? []), note.plain];
    item.pairs = [...(item.pairs ?? []), ...(note.pair ? [note.pair] : [])];
  }
}

interface Pair {
  plan: string;
  built: string;
}

/** One difference, as the terminal's short text, a short sentence and, where it has two values, a pair. */
export interface Note {
  text: string;
  plain: string;
  pair?: Pair;
}

/** Notes folded into an item's `detail` and `plain`. */
export const detailOf = (notes: readonly Note[]): Pick<DriftItem<unknown>, 'detail' | 'plain' | 'pairs'> => ({
  detail: notes.map((n) => n.text).join(', '),
  plain: notes.map((n) => n.plain),
  pairs: notes.flatMap((n) => (n.pair ? [n.pair] : [])),
});
