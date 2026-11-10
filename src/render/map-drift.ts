import type { Field, Spec, SpecNode } from '../spec/schema.js';
import { detailOf, noteDifference, pairItems, withReasons, type Drift, type DriftChange, type DriftItem, type Note } from './drift.js';

type Items = Map<string, DriftItem<SpecNode>>;
type Pairs = Map<SpecNode, SpecNode>;

const norm = (path: string | undefined) => path?.replace(/^\.\//, '').replace(/\/$/, '');

const sameSpot = (plan: SpecNode, built: SpecNode): boolean =>
  plan.path !== undefined && norm(plan.path) === norm(built.path) && (plan.match === undefined || built.match === undefined || plan.match === built.match);

// A new node's fields are all its own; a changed one's are those marked.
const shownFields = (node: SpecNode): Map<string, Field> =>
  new Map((node.fields ?? []).filter((f) => node.status === 'new' || f.change !== undefined).map((f) => [f.name, f]));

/** A node that lists only the fields its author saw says nothing about the others. */
const listsAll = (node: SpecNode): boolean => node.fieldsComplete !== false;

function fieldDifferences(plan: SpecNode, built: SpecNode): Note[] {
  const planned = shownFields(plan);
  const made = shownFields(built);
  const found: Note[] = [];
  for (const [name, p] of planned) {
    const b = made.get(name);
    if (!b) {
      if (listsAll(built)) found.push({ text: `field ${name} not built`, plain: 'A field the plan listed was not built.', pair: { plan: `\`${name}\``, built: 'not built' } });
    } else if (p.type !== b.type) found.push({ text: `field ${name}: ${p.type ?? '?'} → ${b.type ?? '?'}`, plain: 'A field has a different type than the plan said.', pair: { plan: `\`${name}: ${p.type ?? '?'}\``, built: `\`${name}: ${b.type ?? '?'}\`` } });
    else if (p.change !== b.change) found.push({ text: `field ${name}: ${p.change ?? 'kept'} → ${b.change ?? 'kept'}`, plain: 'A field was changed differently than the plan said.', pair: { plan: `\`${name}\` ${p.change ?? 'kept'}`, built: `\`${name}\` ${b.change ?? 'kept'}` } });
  }
  for (const name of made.keys()) if (!planned.has(name) && listsAll(plan)) found.push({ text: `field ${name} not planned`, plain: "A field was built that the plan didn't list.", pair: { plan: 'not in the plan', built: `\`${name}\`` } });
  const more = found.length - 2;
  return more > 0 ? [...found.slice(0, 2), { text: `+${more} more`, plain: `And ${more} more field differences.` }] : found;
}

function differences(plan: SpecNode, built: SpecNode): Note[] {
  const found: Note[] = [];
  if (plan.path !== undefined && built.path !== undefined && norm(plan.path) !== norm(built.path)) {
    found.push({ text: `path ${plan.path} → ${built.path}`, plain: 'It was built in another file than the plan said.', pair: { plan: `\`${plan.path}\``, built: `\`${built.path}\`` } });
  }
  if (plan.status !== built.status) found.push({ text: `status ${plan.status} → ${built.status}`, plain: 'It was built with a different status than the plan said.', pair: { plan: `\`${plan.status}\``, built: `\`${built.status}\`` } });
  return [...found, ...fieldDifferences(plan, built)];
}

const noun = (n: SpecNode): string => (n.kind === 'other' ? 'node' : (n.kind ?? 'file'));
const at = (n: SpecNode) => ({ id: n.id, label: n.label, noun: noun(n) });
const CHANGE: Record<SpecNode['status'], DriftChange> = { new: 'add', changed: 'change', config: 'change', removed: 'remove', context: 'change', existing: 'change', outside: 'change' };

function plannedNodes(plan: Spec, pairs: Pairs, items: Items): void {
  for (const p of plan.nodes) {
    if (p.status === 'context') continue;
    const b = pairs.get(p);
    if (!b || b.status === 'context') {
      const id = b?.id ?? p.id;
      items.set(id, { id, label: p.label, noun: noun(p), change: CHANGE[p.status], kind: 'missing', ...(b ? { detail: 'left unchanged' } : { ghost: p }) });
      continue;
    }
    const found = differences(p, b);
    if (found.length) items.set(b.id, { ...at(b), kind: 'different', ...detailOf(found) });
  }
}

function addedLinks(plan: Spec, summary: Spec, pairs: Pairs, items: Items): void {
  const built = new Map([...pairs].map(([p, b]) => [p.id, b]));
  for (const e of plan.edges) {
    const from = built.get(e.from);
    const to = built.get(e.to);
    if (e.change !== 'added' || !from || !to || summary.edges.some((s) => s.from === from.id && s.to === to.id)) continue;
    noteDifference(items, at(from), { text: `link to ${to.label} not built`, plain: 'A link the plan asked for was not built.', pair: { plan: `link to ${to.label}`, built: 'not built' } });
  }
}

function unplannedNodes(summary: Spec, pairs: Pairs, items: Items): void {
  const planOf = new Map([...pairs].map(([p, b]) => [b, p]));
  for (const b of summary.nodes) {
    if (b.status !== 'context' && (planOf.get(b)?.status ?? 'context') === 'context') items.set(b.id, { ...at(b), kind: 'unplanned', change: CHANGE[b.status] });
  }
}

/** What the summary built against the plan's nodes, fields and added links; labels and notes never count. */
export function compareMaps(plan: { spec: Spec; savedAt: string }, summary: Spec): Drift<SpecNode> {
  const pairs = pairItems(plan.spec.nodes, summary.nodes, sameSpot);
  const items: Items = new Map();
  plannedNodes(plan.spec, pairs, items);
  addedLinks(plan.spec, summary, pairs, items);
  unplannedNodes(summary, pairs, items);
  const renamed = new Map([...pairs].filter(([p, b]) => p.id !== b.id).map(([p, b]) => [p.id, b.id]));
  const reasons = (summary.drift ?? []).map((d) => ({ id: d.node, cause: d.cause, why: d.why }));
  return withReasons({ title: plan.spec.title, savedAt: plan.savedAt }, [...items.values()], reasons, renamed);
}
