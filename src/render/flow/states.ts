import { isPlannedLink, isRemovedLink, type FlowLink, type FlowSpec, type FlowStep } from '../../spec/flow.js';
import type { KeyPart } from '../web/page.js';
import type { Side } from '../web/states.js';

/** A planned step with an anchor alters code that exists now; without one it is not in the code yet. */
export const isAltered = (step: FlowStep): boolean => step.status === 'planned' && step.source !== undefined;

/** A plan that only adds steps keeps one flow, like a map. */
export function hasFlowNowAfter(spec: FlowSpec): boolean {
  if (spec.kind !== 'plan') return false;
  return spec.steps.some((s) => s.status === 'removed' || isAltered(s)) || spec.links.some((l) => l.removed === true);
}

export const FLOW_SIDE_KEY: Record<Side, KeyPart[]> = {
  now: [
    { text: 'red: removed by the plan', tone: 'rem' },
    { text: 'amber: changed by it', tone: 'chg' },
  ],
  after: [{ text: 'dashed: planned', tone: 'cfg' }],
};

export const stepOn = (side: Side, step: FlowStep): boolean =>
  side === 'now' ? step.status !== 'planned' || isAltered(step) : step.status !== 'removed';

/** Now drops links the plan adds; a link only planned because it touches an altered step exists now. */
export function linkOn(side: Side, spec: FlowSpec, link: FlowLink, byId: Map<string, FlowStep>): boolean {
  const ends = [byId.get(link.from)!, byId.get(link.to)!];
  if (!ends.every((s) => stepOn(side, s))) return false;
  return side === 'now' ? link.planned !== true : !isRemovedLink(spec, link);
}

/** How a link is drawn on a side: what it loses in red, what it gains in the flow's planned style. */
export function linkTone(side: Side | undefined, spec: FlowSpec, link: FlowLink): 'planned' | 'removed' | undefined {
  if (side !== 'after' && isRemovedLink(spec, link)) return 'removed';
  if (side === 'now') return undefined;
  return isPlannedLink(spec, link) ? 'planned' : undefined;
}
