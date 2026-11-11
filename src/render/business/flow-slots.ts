/** One vertical run of an arrow, from `y1` to `y2`, and the heights of the horizontal pieces that meet it on its left and on its right. */
export interface Seg {
  y1: number;
  y2: number;
  left: number[];
  right: number[];
}

const MAX_SEARCH = 7;

const within = (y: number, s: Seg): boolean => y > Math.min(s.y1, s.y2) && y < Math.max(s.y1, s.y2);

/** Crossings if `a` sits left of `b`: a's way out to the right meets b's vertical, or b's way in from the left meets a's. */
const crossings = (a: Seg, b: Seg): number => a.right.filter((y) => within(y, b)).length + b.left.filter((y) => within(y, a)).length;

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
  if (segs.length > MAX_SEARCH) return all.sort((i, j) => segs[i]!.y1 - segs[j]!.y1);
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

/** What `trackOrder` needs of an arrow that runs along a lane edge: the gaps of its two verticals, its span, and whether its target is out beyond that edge. */
export interface Track {
  g1: number;
  g2: number;
  span: number;
  far: boolean;
}

const strictlyIn = (g: number, t: Track): boolean => g > Math.min(t.g1, t.g2) && g < Math.max(t.g1, t.g2);

/** Crossings if `inner` runs closer to the nodes than `outer`: `inner`'s way out beyond the edge meets `outer`'s run, or `outer`'s ways in meet `inner`'s. */
const nesting = (inner: Track, outer: Track): number => Number(inner.far && strictlyIn(inner.g2, outer)) + Number(strictlyIn(outer.g1, inner)) + Number(!outer.far && strictlyIn(outer.g2, inner));

/** The arrows along one lane edge from the innermost to the outermost, with the fewest crossings; ties go to the shorter span inside. */
export function trackOrder(tracks: Track[]): number[] {
  const base = tracks.map((_, i) => i).sort((i, j) => tracks[i]!.span - tracks[j]!.span || tracks[i]!.g1 - tracks[j]!.g1 || tracks[i]!.g2 - tracks[j]!.g2);
  if (tracks.length > MAX_SEARCH) return base;
  let best = base;
  let low = Infinity;
  for (const order of permutations(base)) {
    let total = 0;
    for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) total += nesting(tracks[order[i]!]!, tracks[order[j]!]!);
    if (total < low) {
      low = total;
      best = order;
    }
  }
  return best;
}
