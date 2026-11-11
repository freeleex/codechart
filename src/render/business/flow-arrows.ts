import type { FlowLane, FlowNode, Pt } from './flow-layout.js';
import { sidesOf, type Port, type Spot } from './flow-ports.js';
import { trackOrder, type Seg } from './flow-slots.js';
import type { Flow } from '../../spec/business.js';

export const TRACK = 10;
export const SLOT = 12;
const RISER = 18;

export interface Raw {
  node: FlowNode;
  idx: number;
  layer: number;
  row: number;
}

export interface Arrow {
  a: Raw;
  b: Raw;
  label?: string;
  port: Port;
  below: boolean;
  slot: number;
  corridor?: { lane: number; below: boolean; track: number };
}


const rank = (r: Raw): number => r.node.lane * 1000 + r.row;
const spot = (r: Raw): Spot => ({ rank: rank(r), layer: r.layer, idx: r.idx });

export function arrowsOf(flow: Flow, raws: Raw[]): Arrow[] {
  const byId = new Map(raws.map((r) => [r.node.id, r]));
  const out = new Map<string, number[]>();
  flow.arrows.forEach((a, k) => out.set(a.from, [...(out.get(a.from) ?? []), k]));
  const list: Arrow[] = [];
  for (const [from, ks] of out) {
    const a = byId.get(from)!;
    const targets = ks.map((k) => byId.get(flow.arrows[k]!.to)!);
    const sides = sidesOf(a.node.kind === 'question', spot(a), targets.map(spot));
    ks.forEach((k, n) => {
      const side = sides[n]!;
      const port: Port = side === 'right' ? 'right' : side === 'up' ? 'top' : 'bottom';
      const below = side === 'right' ? rank(targets[n]!) >= rank(a) : side === 'down';
      list.push({ a, b: targets[n]!, label: flow.arrows[k]!.label, port, below, slot: 0 });
    });
  }
  list.sort((p, q) => p.a.idx - q.a.idx || p.b.idx - q.b.idx);
  setTracks(list);
  nestExits(list);
  return list;
}


/** Where an arrow comes from, top to bottom: along a lane edge it arrives from that side, outer track nearest the edge. */
const approach = (e: Arrow): number => (e.corridor ? (e.corridor.below ? 1e6 - e.corridor.track : e.corridor.track - 1e6) : rank(e.a));

/** Entry heights: arrows into one step arrive a slot apart, ordered by where they come from. */
export function entries(list: Arrow[]): Map<Arrow, number> {
  const into = new Map<Raw, Arrow[]>();
  for (const e of list) into.set(e.b, [...(into.get(e.b) ?? []), e]);
  const y = new Map<Arrow, number>();
  for (const [b, es] of into) {
    es.sort((p, q) => approach(p) - approach(q) || p.a.idx - q.a.idx);
    const max = b.node.h / 2 - 8;
    es.forEach((e, i) => y.set(e, b.node.cy + Math.max(-max, Math.min(max, (i - (es.length - 1) / 2) * SLOT))));
  }
  return y;
}

export const exitOf = (e: Arrow): Pt => {
  const { cx, cy, w, h } = e.a.node;
  const at = { right: [w / 2, 0], top: [0, -h / 2], bottom: [0, h / 2], upper: [w / 4, -h / 4], lower: [w / 4, h / 4] }[e.port];
  return { x: cx + at[0]!, y: cy + at[1]! };
};
export const startY = (e: Arrow): number => exitOf(e).y + (e.port === 'top' ? -RISER : e.port === 'bottom' ? RISER : 0);

export interface Vertical {
  e: Arrow;
  gap: number;
  seg: Seg;
}

/** The vertical runs of each arrow, with the gap between columns they sit in. */
export function verticals(list: Arrow[], lanes: FlowLane[], entry: Map<Arrow, number>): Vertical[] {
  const out: Vertical[] = [];
  for (const e of list) {
    const from = startY(e);
    const to = entry.get(e)!;
    if (!e.corridor) {
      if (from !== to) out.push({ e, gap: e.a.layer + 1, seg: { y1: from, y2: to, left: [from], right: [to] } });
      continue;
    }
    const line = corridorY(e, lanes[e.corridor.lane]!);
    const back = e.b.layer <= e.a.layer;
    out.push(
      { e, gap: e.a.layer + 1, seg: { y1: from, y2: line, left: back ? [from, line] : [from], right: back ? [] : [line] } },
      { e, gap: e.b.layer, seg: { y1: line, y2: to, left: back ? [] : [line], right: back ? [line, to] : [to] } },
    );
  }
  return out;
}

export const corridorY = (e: Arrow, lane: FlowLane): number => (e.corridor!.below ? lane.top + lane.height - 8 - TRACK * e.corridor!.track : lane.top + 8 + TRACK * e.corridor!.track);


const isLong = (e: Arrow): boolean => e.b.layer !== e.a.layer + 1;

/** Lane-edge tracks: the order along each lane edge with the fewest crossings, the outermost track first; independent of the order of the arrows. */
function setTracks(list: Arrow[]): void {
  const long = list.filter(isLong);
  const groups = new Map<string, Arrow[]>();
  for (const e of long) groups.set(`${e.a.node.lane}${e.below}`, [...(groups.get(`${e.a.node.lane}${e.below}`) ?? []), e]);
  for (const mates of groups.values()) {
    const info = mates.map((e) => ({ g1: e.a.layer + 1, g2: e.b.layer, span: Math.abs(e.b.layer - e.a.layer), far: e.below ? e.b.node.lane > e.a.node.lane : e.b.node.lane < e.a.node.lane }));
    const inner = trackOrder(info);
    inner.forEach((m, k) => {
      const e = mates[m]!;
      e.corridor = { lane: e.a.node.lane, below: e.below, track: mates.length - 1 - k };
    });
  }
}

/** Two answers on one side: the vertex goes to the one on the outer track going forward (and to the inner one going back), the middle of the diamond's edge to the other; a forward answer beats a loop back to the edge. */
function nestExits(list: Arrow[]): void {
  const pairs = new Map<string, Arrow[]>();
  for (const e of list) if (e.a.node.kind === 'question' && e.port !== 'right') pairs.set(`${e.a.idx}${e.port}`, [...(pairs.get(`${e.a.idx}${e.port}`) ?? []), e]);
  for (const [x, y] of [...pairs.values()].filter((p) => p.length === 2) as [Arrow, Arrow][]) {
    const fwd = (e: Arrow): boolean => e.b.layer > e.a.layer;
    const track = (e: Arrow): number => e.corridor?.track ?? 1e6 - Math.abs(rank(e.b) - rank(e.a));
    const edge = fwd(x) && fwd(y) ? (track(x) > track(y) ? x : y) : fwd(x) !== fwd(y) ? (fwd(x) ? x : y) : track(x) < track(y) ? x : y;
    const other = edge === x ? y : x;
    edge.port = edge.below ? 'lower' : 'upper';
    other.port = edge.below ? 'bottom' : 'top';
  }
}
