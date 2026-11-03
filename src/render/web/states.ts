import type { Field, Spec, SpecEdge, SpecNode, Status } from '../../spec/schema.js';

/** A plan's two pictures: the code as it is, and as it will be once built. */
export type Side = 'now' | 'after';
export const SIDES: readonly Side[] = ['now', 'after'];
export const SIDE_TITLE: Record<Side, string> = { now: 'Now', after: 'After plan' };

/** A plan that only adds things gets one map: its Now side would show little but context. */
export function hasNowAfter(spec: Spec): boolean {
  if (spec.kind !== 'plan') return false;
  return (
    spec.nodes.some((n) => n.status === 'changed' || n.status === 'removed' || n.fields?.some(touchesExisting)) ||
    spec.edges.some((e) => e.change !== undefined)
  );
}

const touchesExisting = (f: Field) => f.change === 'removed' || f.change === 'modified' || f.was !== undefined;

export const nodeOn = (side: Side, status: Status): boolean => (side === 'now' ? status !== 'new' : status !== 'removed');

/** The edge's own `change`, else what its ends imply: a link to a new node is added, one to a removed node goes. */
export function edgeChange(e: SpecEdge, statusOf: Map<string, Status>): SpecEdge['change'] {
  if (e.change) return e.change;
  const ends = [statusOf.get(e.from), statusOf.get(e.to)];
  if (ends.includes('new')) return 'added';
  if (ends.includes('removed')) return 'removed';
  return undefined;
}

export const edgeOn = (side: Side, change: SpecEdge['change']): boolean => change !== (side === 'now' ? 'added' : 'removed');

/** Fields as they are on that side; Now shows a modified field's old type when the spec gives it. */
export function fieldsOn(side: Side, node: SpecNode): Field[] {
  const fields = node.fields ?? [];
  if (side === 'after') return fields.filter((f) => f.change !== 'removed').map((f) => ({ ...f, was: undefined }));
  return fields.filter((f) => f.change !== 'added').map((f) => (f.was === undefined ? f : { ...f, type: f.was, was: undefined }));
}
