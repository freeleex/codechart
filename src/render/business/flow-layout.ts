import { isQuestion } from '../../spec/business-flow.js';
import type { Flow } from '../../spec/business.js';
import { wrapText } from '../web/layout.js';
import { layersOf, spineOf } from './flow-graph.js';
import { slotOrder, type Seg } from './flow-slots.js';

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

export const LINE = 17;
export const GUTTER = 100;
const PAD = 22;
const TRACK = 10;
const ROW_GAP = 30;
const RISER = 18;
const SLOT = 12;
const STUB = 28;
const EDGE_GAP = 8;
const CHAR = 7.2;
const MAX_LINES = 3;
const LANE_CHARS = 12;

interface Raw {
  node: FlowNode;
  layer: number;
  row: number;
}

interface Arrow {
  a: Raw;
  b: Raw;
  label?: string;
  port: Port;
  below: boolean;
  slot: number;
  corridor?: { lane: number; below: boolean; track: number };
}

/** Where a step sits: wrapped to its text, a diamond wide enough for its question. */
function sizeOf(kind: Kind, text: string): Pick<FlowNode, 'lines' | 'w' | 'h'> {
  const lines = wrapText(text, kind === 'question' ? 15 : 16, MAX_LINES);
  const longest = Math.max(...lines.map((l) => l.length));
  if (kind === 'question') return { lines, w: Math.max(124, Math.ceil(longest * CHAR * 1.4) + 28), h: Math.max(84, Math.round(lines.length * LINE * 1.75) + 16) };
  return { lines, w: Math.max(96, Math.ceil(longest * CHAR) + 28), h: Math.max(42, lines.length * LINE + 20) };
}

/** Rows: the spine in row one of its lane, side steps below it (or from row one in a lane with no spine step). */
function rawNodes(flow: Flow, layer: number[]): Raw[] {
  const laneOf = new Map(flow.lanes.map((l, i) => [l.id, i]));
  const spine = spineOf(flow, layer);
  const spineLanes = new Set([...spine].map((i) => laneOf.get(flow.steps[i]!.lane) ?? 0));
  const next = new Map<string, number>();
  return flow.steps.map((s, i) => {
    const kind: Kind = isQuestion(s.text) ? 'question' : flow.arrows.some((a) => a.from === s.id) ? 'action' : 'end';
    const lane = laneOf.get(s.lane) ?? 0;
    const key = `${lane}:${layer[i]}`;
    const row = spine.has(i) ? 0 : (next.get(key) ?? (spineLanes.has(lane) ? 1 : 0));
    if (!spine.has(i)) next.set(key, row + 1);
    return { node: { id: s.id, kind, reading: s.evidence === 'reading', text: s.text, lane, cx: 0, cy: 0, ...sizeOf(kind, s.text) }, layer: layer[i]!, row };
  });
}

const rank = (r: Raw): number => r.node.lane * 1000 + r.row;

/** Which vertex each arrow out of a step leaves from: a question's answers fan out top, right and bottom. */
function portsOf(a: Raw, targets: Raw[]): Port[] {
  const ports = targets.map((): Port => 'right');
  if (a.node.kind !== 'question' || targets.length < 2) return ports;
  const order = targets.map((_, i) => i).sort((i, j) => rank(targets[i]!) - rank(targets[j]!) || i - j);
  const first = order[0]!;
  const last = order[order.length - 1]!;
  if (rank(targets[first]!) < rank(a)) ports[first] = 'top';
  if (rank(targets[last]!) > rank(a) || ports[first] === 'right') ports[last] = 'bottom';
  return ports;
}

function arrowsOf(flow: Flow, raws: Raw[]): Arrow[] {
  const byId = new Map(raws.map((r) => [r.node.id, r]));
  const out = new Map<string, number[]>();
  flow.arrows.forEach((a, k) => out.set(a.from, [...(out.get(a.from) ?? []), k]));
  const list: Arrow[] = [];
  for (const [from, ks] of out) {
    const a = byId.get(from)!;
    const targets = ks.map((k) => byId.get(flow.arrows[k]!.to)!);
    const ports = portsOf(a, targets);
    ks.forEach((k, n) => list[k] = { a, b: targets[n]!, label: flow.arrows[k]!.label, port: ports[n]!, below: rank(targets[n]!) >= rank(a), slot: 0 });
  }
  const tracks = new Map<string, number>();
  for (const e of list) {
    if (!e || e.b.layer === e.a.layer + 1) continue;
    const key = `${e.a.node.lane}${e.below}`;
    const track = tracks.get(key) ?? 0;
    tracks.set(key, track + 1);
    e.corridor = { lane: e.a.node.lane, below: e.below, track };
  }
  return list.filter(Boolean);
}

/** Lane bands as tall as their rows plus room for the arrows that run along their edges; sets every step's y. */
function laneBands(flow: Flow, raws: Raw[], list: Arrow[]): FlowLane[] {
  let top = 0;
  const lanes = flow.lanes.map((l, i): FlowLane => {
    const mine = raws.filter((r) => r.node.lane === i);
    const rows = Math.max(1, ...mine.map((r) => r.row + 1));
    const rowH = Math.max(42, ...mine.map((r) => r.node.h));
    const count = (below: boolean): number => list.filter((e) => e.corridor?.lane === i && e.corridor.below === below).length;
    const above = PAD + TRACK * count(false);
    const height = above + rows * rowH + (rows - 1) * ROW_GAP + PAD + TRACK * count(true);
    for (const r of mine) r.node.cy = top + above + r.row * (rowH + ROW_GAP) + rowH / 2;
    const lane = { name: l.name, lines: wrapText(l.name.toUpperCase(), LANE_CHARS, MAX_LINES), top, height };
    top += height;
    return lane;
  });
  return lanes;
}

/** Entry heights: arrows into one step arrive a slot apart, ordered by where they come from. */
function entries(list: Arrow[]): Map<Arrow, number> {
  const into = new Map<Raw, Arrow[]>();
  for (const e of list) into.set(e.b, [...(into.get(e.b) ?? []), e]);
  const y = new Map<Arrow, number>();
  for (const [b, es] of into) {
    es.sort((p, q) => rank(p.a) - rank(q.a));
    const max = b.node.h / 2 - 8;
    es.forEach((e, i) => y.set(e, b.node.cy + Math.max(-max, Math.min(max, (i - (es.length - 1) / 2) * SLOT))));
  }
  return y;
}

const topOf = (n: FlowNode): number => n.cy - n.h / 2;
const startY = (e: Arrow): number => (e.port === 'right' ? e.a.node.cy : e.port === 'top' ? topOf(e.a.node) - RISER : e.a.node.cy + e.a.node.h / 2 + RISER);

interface Vertical {
  e: Arrow;
  gap: number;
  seg: Seg;
}

/** The vertical runs of each arrow, with the gap between columns they sit in. */
function verticals(list: Arrow[], lanes: FlowLane[], entry: Map<Arrow, number>): Vertical[] {
  const out: Vertical[] = [];
  for (const e of list) {
    const from = startY(e);
    const to = entry.get(e)!;
    if (!e.corridor) {
      if (from !== to) out.push({ e, gap: e.a.layer + 1, seg: { left: from, right: to } });
      continue;
    }
    const lane = lanes[e.corridor.lane]!;
    const line = corridorY(e, lane);
    out.push({ e, gap: e.a.layer + 1, seg: { left: from, right: line } }, { e, gap: e.b.layer, seg: { left: line, right: to } });
  }
  return out;
}

const corridorY = (e: Arrow, lane: FlowLane): number => (e.corridor!.below ? lane.top + lane.height - 8 - TRACK * e.corridor!.track : lane.top + 8 + TRACK * e.corridor!.track);

interface Columns {
  x: number[];
  width: number[];
  slotX: Map<Vertical, number>;
  total: number;
}

/** Column x positions: each gap is as wide as its arrows need, one slot per vertical run, ordered so the runs cross as little as possible. */
function columns(raws: Raw[], runs: Vertical[], count: number): Columns {
  const width = Array.from({ length: count }, (_, c) => Math.max(...raws.filter((r) => r.layer === c).map((r) => r.node.w), 0));
  const slotX = new Map<Vertical, number>();
  const x: number[] = [];
  let cursor = GUTTER;
  for (let g = 0; g <= count; g++) {
    const here = runs.filter((v) => v.gap === g);
    const base = g === 0 ? 14 : STUB;
    const order = slotOrder(here.map((v) => v.seg));
    order.forEach((i, k) => slotX.set(here[i]!, cursor + base + k * SLOT));
    const tail = g === count ? 10 : EDGE_GAP + 10;
    cursor += here.length ? base + (here.length - 1) * SLOT + tail : g === 0 || g === count ? 12 : 40;
    if (g < count) {
      x.push(cursor);
      cursor += width[g]!;
    }
  }
  return { x, width, slotX, total: cursor };
}

function entryPoint(b: FlowNode, y: number): Pt {
  const left = b.cx - b.w / 2;
  return { x: b.kind === 'question' ? left + (Math.abs(y - b.cy) * b.w) / b.h : left, y };
}

function labelAt(e: Arrow, start: Pt, y: number): Pt {
  if (e.port === 'right') return { x: start.x + 6, y: y + (e.below ? -6 : 17) };
  return { x: start.x + 8, y: y + (e.port === 'top' ? -6 : 17) };
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

function edgeOf(e: Arrow, lanes: FlowLane[], entry: Map<Arrow, number>, mine: Vertical[], cols: Columns): FlowEdge {
  const a = e.a.node;
  const start: Pt = e.port === 'right' ? { x: a.cx + a.w / 2, y: a.cy } : { x: a.cx, y: e.port === 'top' ? topOf(a) : a.cy + a.h / 2 };
  const y = startY(e);
  const pts: Pt[] = [start, { x: start.x, y }];
  const slot = (i: number): number => cols.slotX.get(mine[i]!)!;
  const end = entryPoint(e.b.node, entry.get(e)!);
  if (e.corridor) {
    const line = corridorY(e, lanes[e.corridor.lane]!);
    pts.push({ x: slot(0), y }, { x: slot(0), y: line }, { x: slot(1), y: line }, { x: slot(1), y: end.y });
  } else if (mine.length) pts.push({ x: slot(0), y }, { x: slot(0), y: end.y });
  pts.push(end);
  return { points: dedupe(pts), ...(e.label !== undefined && { label: { text: e.label, at: labelAt(e, start, y), anchor: 'start' as const, lane: a.lane } }) };
}

/** Swimlane layout: a column per layer, a band per lane, the spine straight and side branches in rows below it; every arrow has its own channel and entry point. */
export function layoutFlow(flow: Flow): FlowLayout {
  const layer = layersOf(flow);
  const raws = rawNodes(flow, layer);
  const list = arrowsOf(flow, raws);
  const lanes = laneBands(flow, raws, list);
  const entry = entries(list);
  const runs = verticals(list, lanes, entry);
  const count = Math.max(...layer) + 1;
  const cols = columns(raws, runs, count);
  for (const r of raws) r.node.cx = cols.x[r.layer]! + cols.width[r.layer]! / 2;
  const edges = list.map((e) => edgeOf(e, lanes, entry, runs.filter((v) => v.e === e), cols));
  return { width: cols.total, height: lanes.reduce((h, l) => h + l.height, 0), lanes, nodes: raws.map((r) => r.node), edges };
}
