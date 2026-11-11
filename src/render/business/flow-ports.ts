export type Port = 'right' | 'top' | 'bottom' | 'upper' | 'lower';
export type Side = 'right' | 'up' | 'down';

/** Where a step sits: its vertical rank (lane, then row) and its column. */
export interface Spot {
  rank: number;
  layer: number;
  idx: number;
}

/** Which side of a question each answer leaves on, by where its target sits: the nearest target in a later column goes straight out on the right (a loop back never does), the others up or down toward their target. At most two share a side. The result does not depend on the order of the arrows. */
export function sidesOf(question: boolean, own: Spot, targets: Spot[]): Side[] {
  const sides = targets.map((): Side => 'right');
  if (!question || targets.length < 2) return sides;
  const fwd = (t: number): boolean => targets[t]!.layer > own.layer;
  const key = (t: Spot): number[] => [t.layer > own.layer ? 0 : 1, Math.abs(t.layer - own.layer), Math.abs(t.rank - own.rank), t.rank, t.idx];
  const order = targets
    .map((_, i) => i)
    .sort((i, j) => key(targets[i]!).map((x, n) => x - key(targets[j]!)[n]!).find((d) => d !== 0) ?? 0);
  const rest = fwd(order[0]!) ? order.slice(1) : order;
  const up = rest.filter((t) => targets[t]!.rank < own.rank);
  const down = rest.filter((t) => targets[t]!.rank >= own.rank);
  while (up.length > 2) down.push(up.pop()!);
  while (down.length > 2) up.push(down.pop()!);
  for (const t of up) sides[t] = 'up';
  for (const t of down) sides[t] = 'down';
  return sides;
}
