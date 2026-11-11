import { isQuestion } from '../../spec/business-flow.js';
import type { Flow } from '../../spec/business.js';
import { wrapText } from '../web/layout.js';

export interface Pt {
  x: number;
  y: number;
}

export type Kind = 'action' | 'question' | 'end';

export interface FlowNode {
  id: string;
  kind: Kind;
  reading: boolean;
  text: string;
  lines: string[];
  lane: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface FlowEdge {
  points: Pt[];
  label?: { text: string; at: Pt; anchor: 'start' | 'middle'; lane: number };
}

export interface FlowLane {
  name: string;
  lines: string[];
  top: number;
  height: number;
}

export interface FlowLayout {
  width: number;
  height: number;
  lanes: FlowLane[];
  nodes: FlowNode[];
  edges: FlowEdge[];
}

type Port = 'right' | 'top' | 'bottom';

export const LINE = 14;
export const GUTTER = 104;
const PITCH = 224;
const PAD_Y = 34;
const ROW_GAP = 18;
const TRACK = 7;
const RISER = 14;
const SIZE = { action: { w: 140, chars: 19 }, end: { w: 140, chars: 19 }, question: { w: 180, chars: 14 } } as const;
const MAX_LINES = 3;
const LANE_CHARS = 12;

const channel = (layer: number): number => GUTTER + layer * PITCH;

/** Longest-path layers over the arrows, ignoring the ones that loop back to a step still being walked. */
function layersOf(flow: Flow): number[] {
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
function spineOf(flow: Flow, layer: number[]): Set<number> {
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

/** Which vertex of a step each arrow out of it leaves from: a question's answers fan out top, right and bottom. */
function portsOf(a: FlowNode, targets: FlowNode[]): Port[] {
  const ports = targets.map((): Port => 'right');
  if (a.kind !== 'question' || targets.length < 2) return ports;
  const order = targets.map((_, i) => i).sort((i, j) => targets[i]!.cy - targets[j]!.cy || i - j);
  const first = order[0]!;
  const last = order[order.length - 1]!;
  if (targets[first]!.cy < a.cy - 2) ports[first] = 'top';
  if (targets[last]!.cy > a.cy + 2 || ports[first] === 'right') ports[last] = 'bottom';
  return ports;
}

function dedupe(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && prev.x === p.x && prev.y === p.y) continue;
    const before = out[out.length - 2];
    if (prev && before && ((before.x === prev.x && prev.x === p.x) || (before.y === prev.y && prev.y === p.y))) out.pop();
    out.push(p);
  }
  return out;
}

interface Placed {
  nodes: FlowNode[];
  lanes: FlowLane[];
  stepLayer: Map<string, number>;
  width: number;
  height: number;
}

/** Sizes every step, puts the spine in row one of its lane and side steps in rows below, and stacks the lane bands. */
function place(flow: Flow, layer: number[]): Placed {
  const laneOf = new Map(flow.lanes.map((l, i) => [l.id, i]));
  const spine = spineOf(flow, layer);
  const spineLanes = new Set([...spine].map((i) => laneOf.get(flow.steps[i]!.lane) ?? 0));
  const rowAt = new Map<string, number>();
  const sized = flow.steps.map((s, i) => {
    const hasOut = flow.arrows.some((a) => a.from === s.id);
    const kind: Kind = isQuestion(s.text) ? 'question' : hasOut ? 'action' : 'end';
    const { w, chars } = SIZE[kind];
    const lines = wrapText(s.text, chars, MAX_LINES);
    const textH = lines.length * LINE;
    const h = kind === 'question' ? Math.max(76, Math.round(textH * 1.8) + 14) : Math.max(40, textH + 18);
    const lane = laneOf.get(s.lane) ?? 0;
    const key = `${lane}:${layer[i]}`;
    const row = spine.has(i) ? 0 : (rowAt.get(key) ?? (spineLanes.has(lane) ? 1 : 0));
    if (!spine.has(i)) rowAt.set(key, row + 1);
    return { node: { id: s.id, kind, reading: s.evidence === 'reading', text: s.text, lines, lane, cx: channel(layer[i]!) + PITCH / 2, cy: 0, w, h }, row };
  });
  const rows = flow.lanes.map((_, l) => Math.max(1, ...sized.filter((x) => x.node.lane === l).map((x) => x.row + 1)));
  const rowH = flow.lanes.map((_, l) => Math.max(40, ...sized.filter((x) => x.node.lane === l).map((x) => x.node.h)));
  let top = 0;
  const lanes = flow.lanes.map((l, i): FlowLane => {
    const height = 2 * PAD_Y + rows[i]! * rowH[i]! + (rows[i]! - 1) * ROW_GAP;
    const lane = { name: l.name, lines: wrapText(l.name.toUpperCase(), LANE_CHARS, MAX_LINES), top, height };
    top += height;
    return lane;
  });
  for (const { node, row } of sized) node.cy = lanes[node.lane]!.top + PAD_Y + row * (rowH[node.lane]! + ROW_GAP) + rowH[node.lane]! / 2;
  return { nodes: sized.map((x) => x.node), lanes, stepLayer: new Map(flow.steps.map((s, i) => [s.id, layer[i]!])), width: channel(Math.max(...layer) + 1), height: top };
}

/** Elbow arrows: a step to the next column bends once or twice in the gap between them; one that skips columns or loops back runs along its lane's edge. */
function route(flow: Flow, { nodes, lanes, stepLayer }: Placed): FlowEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const used = new Map<string, number>();
  const nextOf = (key: string): number => {
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    return n;
  };
  const spread = (c: number): number => ((nextOf(`c${c}`) % 3) - 1) * TRACK;
  const out = new Map<string, number[]>();
  flow.arrows.forEach((a, k) => out.set(a.from, [...(out.get(a.from) ?? []), k]));
  const edges: FlowEdge[] = [];
  for (const [from, arrows] of out) {
    const a = byId.get(from)!;
    const targets = arrows.map((k) => byId.get(flow.arrows[k]!.to)!);
    const ports = portsOf(a, targets);
    arrows.forEach((k, n) => {
      const b = targets[n]!;
      const port = ports[n]!;
      const la = stepLayer.get(a.id)!;
      const lb = stepLayer.get(b.id)!;
      const start: Pt = port === 'right' ? { x: a.cx + a.w / 2, y: a.cy } : { x: a.cx, y: a.cy + (port === 'top' ? -a.h / 2 : a.h / 2) };
      const pts: Pt[] = [start];
      let y = start.y;
      if (port !== 'right') {
        y += port === 'top' ? -RISER : RISER;
        pts.push({ x: start.x, y });
      }
      const end: Pt = { x: b.cx - b.w / 2, y: b.cy };
      if (lb !== la + 1) {
        const below = b.cy >= a.cy;
        const lane = lanes[a.lane]!;
        const t = ((nextOf(`${a.lane}${below}`) % 3) + 1) * TRACK;
        const lineY = below ? lane.top + lane.height - t : lane.top + t;
        const x1 = channel(la + 1) + spread(la + 1);
        const x2 = channel(lb) + spread(lb);
        pts.push({ x: x1, y }, { x: x1, y: lineY }, { x: x2, y: lineY }, { x: x2, y: end.y });
      } else if (end.y !== y) {
        const x1 = channel(la + 1) + spread(la + 1);
        pts.push({ x: x1, y }, { x: x1, y: end.y });
      }
      pts.push(end);
      const edge: FlowEdge = { points: dedupe(pts) };
      const label = flow.arrows[k]!.label;
      if (label !== undefined) {
        const at: Pt = port === 'right' ? { x: start.x + 4, y: start.y + (end.y >= start.y ? -5 : 13) } : { x: start.x + 6, y: y + (port === 'top' ? -5 : 15) };
        edge.label = { text: label, at, anchor: 'start', lane: a.lane };
      }
      edges.push(edge);
    });
  }
  return edges;
}

/** Swimlane layout: a column per layer, a band per lane, the spine straight and side branches in rows below it. */
export function layoutFlow(flow: Flow): FlowLayout {
  const placed = place(flow, layersOf(flow));
  return { width: placed.width, height: placed.height, lanes: placed.lanes, nodes: placed.nodes, edges: route(flow, placed) };
}
