export type Port = 'right' | 'top' | 'bottom' | 'upper' | 'lower';

/** Which point of a question each answer leaves from, by where its target sits (`own` and `targets` are vertical ranks). The nearest target goes straight out on the right; the others leave on the side they lie on, and two on one side use the vertex and the middle of the edge facing it, so no answer crosses another. */
export function portsOf(question: boolean, own: number, targets: number[]): Port[] {
  const ports = targets.map((): Port => 'right');
  if (!question || targets.length < 2) return ports;
  const rest = targets
    .map((_, i) => i)
    .sort((i, j) => Math.abs(targets[i]! - own) - Math.abs(targets[j]! - own) || i - j)
    .slice(1);
  const side = (list: number[], vertex: Port, edge: Port): void => list.forEach((t, k) => (ports[t] = list.length === 2 && k === 0 ? edge : vertex));
  side(rest.filter((t) => targets[t]! < own), 'top', 'upper');
  side(rest.filter((t) => targets[t]! >= own), 'bottom', 'lower');
  return ports;
}
