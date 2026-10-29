import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { FlowSpec, FlowStep } from '../../spec/flow.js';
import { wrapText, type Point } from '../web/layout.js';

export interface FlowLayoutNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  badge?: string;
}
export interface FlowLayoutEdge {
  points: Point[];
  labelAt?: Point;
}
export interface FlowLayout {
  width: number;
  height: number;
  nodes: FlowLayoutNode[];
  edges: FlowLayoutEdge[];
}

export const LINE_HEIGHT = 14;
export const BADGE_HEIGHT = 12;
const PAD = 8;
const MAX_LINES = 3;
const CHAR_W = 6;
const SHAPE = {
  step: { w: 180, chars: 26 },
  end: { w: 180, chars: 26 },
  decision: { w: 220, chars: 18 },
} as const;

function sizeOf(step: FlowStep): Omit<FlowLayoutNode, 'x' | 'y'> {
  const { w, chars } = SHAPE[step.type];
  const lines = wrapText(step.label, chars, MAX_LINES);
  const badge = step.status === 'existing' ? undefined : step.status;
  const content = lines.length * LINE_HEIGHT + (badge ? BADGE_HEIGHT : 0);
  // A diamond's inscribed text box is half its width and height.
  const h = step.type === 'decision' ? 2 * content + 2 * PAD : content + 2 * PAD;
  return { id: step.id, w, h, lines, ...(badge ? { badge } : {}) };
}

// ELK routes to the bounding box; pull endpoints in to the diamond's outline.
function clipToDiamond(p: Point, n: FlowLayoutNode): Point {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  const hw = n.w / 2;
  const hh = n.h / 2;
  const eps = 0.5;
  if (Math.abs(p.y - n.y) < eps || Math.abs(p.y - n.y - n.h) < eps) {
    const dy = hh * (1 - Math.min(1, Math.abs(p.x - cx) / hw));
    return { x: p.x, y: p.y < cy ? cy - dy : cy + dy };
  }
  if (Math.abs(p.x - n.x) < eps || Math.abs(p.x - n.x - n.w) < eps) {
    const dx = hw * (1 - Math.min(1, Math.abs(p.y - cy) / hh));
    return { x: p.x < cx ? cx - dx : cx + dx, y: p.y };
  }
  return p;
}

export async function layoutFlow(spec: FlowSpec): Promise<FlowLayout> {
  const sizes = spec.steps.map(sizeOf);
  const edges: ElkExtendedEdge[] = spec.links.map((l, i) => ({
    id: `e${i}`,
    sources: [l.from],
    targets: [l.to],
    ...(l.label ? { labels: [{ text: l.label, width: l.label.length * CHAR_W + 6, height: LINE_HEIGHT }] } : {}),
  }));
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.padding': '[top=16,left=16,bottom=16,right=16]',
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '48',
      'elk.spacing.edgeLabel': '4',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: sizes.map((s) => ({ id: s.id, width: s.w, height: s.h })),
    edges,
  };
  // Lazy: elkjs costs ~70 ms to load and only the HTML path needs it.
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const root = await new ELK().layout(graph);

  const pos = new Map((root.children ?? []).map((c) => [c.id, c]));
  const nodes = sizes.map((s) => {
    const p = pos.get(s.id);
    return { ...s, x: p?.x ?? 0, y: p?.y ?? 0 };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const decisions = new Set(spec.steps.filter((s) => s.type === 'decision').map((s) => s.id));
  const clip = (p: Point, id: string) => (decisions.has(id) ? clipToDiamond(p, byId.get(id)!) : p);
  const laidOut = new Map((root.edges ?? []).map((e) => [e.id, e]));
  const out: FlowLayoutEdge[] = spec.links.map((link, i) => {
    const e = laidOut.get(`e${i}`);
    const sec = e?.sections?.[0];
    const points = sec
      ? [clip(sec.startPoint, link.from), ...(sec.bendPoints ?? []), clip(sec.endPoint, link.to)]
      : [];
    const lab = e?.labels?.[0];
    return {
      points,
      ...(lab ? { labelAt: { x: (lab.x ?? 0) + (lab.width ?? 0) / 2, y: (lab.y ?? 0) + (lab.height ?? 0) / 2 } } : {}),
    };
  });
  return { width: root.width ?? 0, height: root.height ?? 0, nodes, edges: out };
}
