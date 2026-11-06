import { isPlannedLink, isRemovedLink, type FlowSpec, type FlowStep } from '../../spec/flow.js';
import { noteDifference, pairItems, withReasons, type Drift, type DriftItem } from '../drift.js';

type Items = Map<string, DriftItem<FlowStep>>;
type Pairs = Map<FlowStep, FlowStep>;

const sameSpot = (plan: FlowStep, built: FlowStep): boolean =>
  plan.source !== undefined && plan.source === built.source && (plan.match === undefined || built.match === undefined || plan.match === built.match);

const NOUN: Record<FlowStep['type'], string> = { step: 'step', decision: 'decision', end: 'end step' };
const at = (s: FlowStep) => ({ id: s.id, label: s.label, noun: NOUN[s.type] });

function plannedSteps(plan: FlowSpec, pairs: Pairs, items: Items): void {
  for (const p of plan.steps) {
    const b = pairs.get(p);
    const notBuilt = p.status === 'planned' && (!b || b.status === 'existing');
    const notRemoved = p.status === 'removed' && b !== undefined;
    if (!notBuilt && !notRemoved) continue;
    const id = b?.id ?? p.id;
    const detail = notRemoved ? 'removal not done' : b ? 'left unchanged' : undefined;
    const change = notRemoved ? 'remove' : p.source !== undefined ? 'change' : 'add';
    items.set(id, { id, label: p.label, noun: NOUN[p.type], change, kind: 'missing', ...(detail && { detail }), ...(!b && { ghost: p }) });
  }
}

function builtSteps(summary: FlowSpec, pairs: Pairs, items: Items): void {
  const planOf = new Map([...pairs].map(([p, b]) => [b, p]));
  for (const b of summary.steps) {
    if (b.status !== 'new' && b.status !== 'changed') continue;
    const p = planOf.get(b);
    if (!p || (p.status === 'existing' && b.status === 'new')) items.set(b.id, { ...at(b), kind: 'unplanned', change: b.status === 'new' ? 'add' : 'change' });
    else if (p.status === 'existing') noteDifference(items, at(b), { text: 'changed, plan kept it', plain: 'This step was changed, but the plan kept it as it is.', pair: { plan: 'kept as it is', built: 'changed' } });
  }
}

function plannedLinks(plan: FlowSpec, summary: FlowSpec, pairs: Pairs, items: Items): void {
  const built = new Map([...pairs].map(([p, b]) => [p.id, b]));
  for (const l of plan.links) {
    const from = built.get(l.from);
    const to = built.get(l.to);
    if (!isPlannedLink(plan, l) || isRemovedLink(plan, l) || !from || !to) continue;
    if (!summary.links.some((s) => s.from === from.id && s.to === to.id)) noteDifference(items, at(from), { text: `link to ${to.label} not built`, plain: 'A link the plan asked for was not built.', pair: { plan: `link to ${to.label}`, built: 'not built' } });
  }
}

/** What the summary built against the plan's steps and planned links; labels never count. */
export function compareFlows(plan: { spec: FlowSpec; savedAt: string }, summary: FlowSpec): Drift<FlowStep> {
  const pairs = pairItems(plan.spec.steps, summary.steps, sameSpot);
  const items: Items = new Map();
  plannedSteps(plan.spec, pairs, items);
  builtSteps(summary, pairs, items);
  plannedLinks(plan.spec, summary, pairs, items);
  const renamed = new Map([...pairs].filter(([p, b]) => p.id !== b.id).map(([p, b]) => [p.id, b.id]));
  const reasons = (summary.drift ?? []).map((d) => ({ id: d.step, cause: d.cause, why: d.why }));
  return withReasons({ title: plan.spec.title, savedAt: plan.savedAt }, [...items.values()], reasons, renamed);
}
