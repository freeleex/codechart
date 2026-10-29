import type { Spec, SpecNode, Status } from "../../spec/schema.js";

interface Selection {
  ids: Set<string>;
  hidden: number;
}

const PRIMARY: ReadonlySet<Status> = new Set(["new", "changed", "removed", "config"]);
// The view shows the change; context only explains it, so it never outranks a changed node.
const TIER: Record<Status, number> = {
  new: 0,
  changed: 0,
  removed: 0,
  config: 1,
  context: 2,
};

function candidates(spec: Spec): SpecNode[] {
  if (!spec.nodes.some((n) => TIER[n.status] === 0))
    return spec.nodes;
  const primary = new Set(
    spec.nodes.filter((n) => PRIMARY.has(n.status)).map((n) => n.id),
  );
  const endpoints = new Set(
    spec.edges
      .filter((e) => primary.has(e.from) || primary.has(e.to))
      .flatMap((e) => [e.from, e.to]),
  );
  return spec.nodes.filter((n) => primary.has(n.id) || endpoints.has(n.id));
}

/** Tier (new/changed/removed, config, context), then degree among candidates desc, then spec order. */
function rankByImportance(spec: Spec, nodes: SpecNode[]): SpecNode[] {
  const ids = new Set(nodes.map((n) => n.id));
  const degree = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of spec.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    degree.set(e.from, degree.get(e.from)! + 1);
    degree.set(e.to, degree.get(e.to)! + 1);
  }
  // Array.prototype.sort is stable, so equal keys keep spec order.
  return [...nodes].sort(
    (a, b) =>
      TIER[a.status] - TIER[b.status] || degree.get(b.id)! - degree.get(a.id)!,
  );
}

export function selectTerminalNodes(spec: Spec, max: number): Selection {
  const pool = candidates(spec);
  if (pool.length <= max)
    return { ids: new Set(pool.map((n) => n.id)), hidden: 0 };
  const kept = rankByImportance(spec, pool).slice(0, max);
  return {
    ids: new Set(kept.map((n) => n.id)),
    hidden: pool.length - kept.length,
  };
}
