import type { FlowLink, FlowSpec, FlowStep } from '../../spec/flow.js';

/** `via`: the link from the previous item in the run; absent on a run's first item. */
export type Item =
  | { kind: 'step'; step: FlowStep; via?: FlowLink }
  | { kind: 'ref'; step: FlowStep; via?: FlowLink }
  | { kind: 'cut'; hidden: number; via?: FlowLink };

export interface Arm {
  link: FlowLink;
  chain: Chain;
}

/** A straight run, optionally ending in a branch point (a decision, or any step with 2+ links out). */
export interface Chain {
  items: Item[];
  branch?: { head: FlowStep; arms: Arm[] };
}

interface Block {
  shared: boolean;
  chain: Chain;
}

interface Walk {
  blocks: Block[];
  /** Steps not reachable from `start`. */
  unreachable: number;
  truncated: boolean;
}

/**
 * Blocks in print order: the start block, then one block per shared step (2+ links in, or the start
 * with any link in) in the order first referenced. Each step is placed once, so loops terminate.
 * Returns no blocks when the budget can't hold the start run and its first branch point.
 */
export function walkFlow(spec: FlowSpec, budget: number): Walk {
  const byId = new Map(spec.steps.map((s) => [s.id, s]));
  const out = new Map<string, FlowLink[]>();
  const incoming = new Map<string, number>([[spec.start, 1]]);
  for (const link of spec.links) {
    out.set(link.from, [...(out.get(link.from) ?? []), link]);
    incoming.set(link.to, (incoming.get(link.to) ?? 0) + 1);
  }
  const shared = new Set([...incoming].filter(([, n]) => n > 1).map(([id]) => id));
  const seen = new Set<string>();
  const queue: string[] = [];
  let placed = 0;
  let truncated = false;

  const take = (id: string): boolean => {
    if (placed >= budget) return false;
    placed++;
    seen.add(id);
    return true;
  };

  const cut = (id: string, via?: FlowLink): Item => {
    truncated = true;
    let hidden = 0;
    const stack = [id];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      hidden++;
      stack.push(...(out.get(next) ?? []).map((l) => l.to));
    }
    return { kind: 'cut', hidden, via };
  };

  const ref = (step: FlowStep, via?: FlowLink): Item => {
    if (queue.includes(step.id)) return { kind: 'ref', step, via };
    if (!take(step.id)) return cut(step.id, via);
    queue.push(step.id);
    return { kind: 'ref', step, via };
  };

  const chain = (first: FlowStep, firstPaid: boolean): Chain => {
    const items: Item[] = [];
    let step = first;
    let via: FlowLink | undefined;
    for (let paid = firstPaid; ; paid = false) {
      if (!paid && !take(step.id)) return { items: [...items, cut(step.id, via)] };
      const links = out.get(step.id) ?? [];
      if (step.type === 'decision' || links.length > 1) {
        return { items, branch: { head: step, arms: links.map((link) => ({ link, chain: arm(link.to) })) } };
      }
      items.push({ kind: 'step', step, via });
      if (links.length === 0) return { items };
      via = links[0]!;
      const next = byId.get(via.to)!;
      if (shared.has(next.id)) return { items: [...items, ref(next, via)] };
      step = next;
    }
  };

  const arm = (to: string): Chain => {
    const step = byId.get(to)!;
    return shared.has(to) ? { items: [ref(step)] } : chain(step, false);
  };

  const start = byId.get(spec.start)!;
  let head: Block;
  if (shared.has(start.id)) {
    if (!take(start.id)) return { blocks: [], unreachable: 0, truncated: true };
    queue.push(start.id);
    head = { shared: true, chain: chain(start, true) };
  } else {
    head = { shared: false, chain: chain(start, false) };
  }
  if (head.chain.items.some((i) => i.kind === 'cut')) return { blocks: [], unreachable: 0, truncated: true };

  const blocks = [head];
  for (let i = head.shared ? 1 : 0; i < queue.length; i++) {
    blocks.push({ shared: true, chain: chain(byId.get(queue[i]!)!, true) });
  }
  const unreachable = spec.steps.filter((s) => !seen.has(s.id)).length;
  return { blocks, unreachable, truncated: truncated || unreachable > 0 };
}
