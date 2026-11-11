import type { Flow } from '../../spec/business.js';

/** Longest-path layers over the arrows, ignoring the ones that loop back to a step still being walked. */
export function layersOf(flow: Flow): number[] {
  const index = new Map(flow.steps.map((s, i) => [s.id, i]));
  const out = flow.steps.map(() => [] as number[]);
  const hasIn = new Set<number>();
  for (const a of flow.arrows) {
    const from = index.get(a.from);
    const to = index.get(a.to);
    if (from === undefined || to === undefined) continue;
    out[from]!.push(to);
    hasIn.add(to);
  }
  const state = flow.steps.map(() => 0);
  const order: number[] = [];
  const back = new Set<string>();
  const walk = (n: number): void => {
    state[n] = 1;
    for (const t of out[n]!) {
      if (state[t] === 1) back.add(`${n}>${t}`);
      else if (state[t] === 0) walk(t);
    }
    state[n] = 2;
    order.push(n);
  };
  flow.steps.forEach((_, i) => !hasIn.has(i) && state[i] === 0 && walk(i));
  flow.steps.forEach((_, i) => state[i] === 0 && walk(i));
  const layer = flow.steps.map(() => 0);
  for (const n of order.reverse()) {
    for (const t of out[n]!) if (!back.has(`${n}>${t}`)) layer[t] = Math.max(layer[t]!, layer[n]! + 1);
  }
  return layer;
}

/** The steps on the longest path from a start: the spine, drawn straight in each lane while side branches drop into rows below. */
export function spineOf(flow: Flow, layer: number[]): Set<number> {
  const index = new Map(flow.steps.map((s, i) => [s.id, i]));
  const preds = flow.steps.map(() => [] as number[]);
  for (const a of flow.arrows) {
    const from = index.get(a.from);
    const to = index.get(a.to);
    if (from !== undefined && to !== undefined && layer[to]! === layer[from]! + 1) preds[to]!.push(from);
  }
  const spine = new Set<number>();
  let n = layer.indexOf(Math.max(...layer));
  for (;;) {
    spine.add(n);
    const p = preds[n]![0];
    if (p === undefined) return spine;
    n = p;
  }
}
