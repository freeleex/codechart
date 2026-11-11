export type Port = 'right' | 'top' | 'bottom' | 'upper' | 'lower';

/** Where a step sits: its vertical rank (lane, then row) and its column. */
export interface Spot {
  rank: number;
  layer: number;
}

/** Which point of a question each answer leaves from, by where its target sits. The nearest target in a later column goes straight out on the right (a loop back never does); the others leave on the side they lie on, and two on one side use the vertex and the middle of the edge facing it, so no answer crosses another. The result does not depend on the order of the arrows. */
export function portsOf(question: boolean, own: Spot, targets: Spot[]): Port[] {
  const ports = targets.map((): Port => 'right');
  if (!question || targets.length < 2) return ports;
  const key = (t: Spot): number[] => [t.layer > own.layer ? 0 : 1, Math.abs(t.layer - own.layer), Math.abs(t.rank - own.rank), t.rank, t.layer];
  const order = targets
    .map((_, i) => i)
    .sort((i, j) => {
      const a = key(targets[i]!);
      const b = key(targets[j]!);
      return a.map((x, n) => x - b[n]!).find((d) => d !== 0) ?? i - j;
    });
  const rest = targets[order[0]!]!.layer > own.layer ? order.slice(1) : order;
  const above = rest.filter((t) => targets[t]!.rank < own.rank);
  const below = rest.filter((t) => targets[t]!.rank >= own.rank);
  while (above.length > 2) below.push(above.pop()!);
  while (below.length > 2) above.push(below.pop()!);
  const side = (list: number[], vertex: Port, edge: Port): void => list.forEach((t, k) => (ports[t] = list.length === 2 && k === 0 ? edge : vertex));
  side(above, 'top', 'upper');
  side(below, 'bottom', 'lower');
  return ports;
}
