/** One vertical run of an arrow: it arrives from the left at `left` and leaves to the right at `right`. */
export interface Seg {
  left: number;
  right: number;
}

const MAX_SEARCH = 7;

const within = (y: number, s: Seg): boolean => y > Math.min(s.left, s.right) && y < Math.max(s.left, s.right);

/** Crossings if `a` sits left of `b`: a's way out to the right meets b's vertical, or b's way in from the left meets a's. */
const crossings = (a: Seg, b: Seg): number => Number(within(a.right, b)) + Number(within(b.left, a));

const cost = (order: number[], segs: Seg[]): number => {
  let total = 0;
  for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) total += crossings(segs[order[i]!]!, segs[order[j]!]!);
  return total;
};

function* permutations(items: number[]): Generator<number[]> {
  if (items.length <= 1) return yield items;
  for (let i = 0; i < items.length; i++) for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i]!, ...rest];
}

/** The left-to-right order of the runs in one gap with the fewest crossings (all orders for a few, else by where they start). */
export function slotOrder(segs: Seg[]): number[] {
  const all = segs.map((_, i) => i);
  if (segs.length > MAX_SEARCH) return all.sort((i, j) => segs[i]!.left - segs[j]!.left);
  let best = all;
  let low = Infinity;
  for (const order of permutations(all)) {
    const c = cost(order, segs);
    if (c < low) {
      low = c;
      best = order;
    }
  }
  return best;
}

/** A path without repeated points or points in the middle of a straight run. */
export function dedupe<P extends { x: number; y: number }>(points: P[]): P[] {
  const out: P[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && prev.x === p.x && prev.y === p.y) continue;
    const before = out[out.length - 2];
    if (prev && before && ((before.x === prev.x && prev.x === p.x) || (before.y === prev.y && prev.y === p.y))) out.pop();
    out.push(p);
  }
  return out;
}
