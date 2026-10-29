import type { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js';
import type { Spec } from '../../spec/schema.js';

export interface Point {
  x: number;
  y: number;
}
export interface LayoutGroup {
  layer: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface LayoutEdge {
  from: string;
  to: string;
  label?: string;
  points: Point[];
}
export interface Layout {
  width: number;
  height: number;
  groups: LayoutGroup[];
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

const NODE_WIDTH = 220;
const HEADER_HEIGHT = 28;
const LINE_HEIGHT = 16;
const LAYER_PREFIX = 'layer:';

export const SUMMARY_CHARS_PER_LINE = 34;
export const SUMMARY_MAX_LINES = 3;

export function wrapSummary(text: string): string[] {
  return wrapText(text, SUMMARY_CHARS_PER_LINE, SUMMARY_MAX_LINES);
}

export function wrapText(text: string, chars: number, maxLines: number): string[] {
  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((w) => {
      const parts: string[] = [];
      for (let i = 0; i < w.length; i += chars) {
        parts.push(w.slice(i, i + chars));
      }
      return parts;
    });
  const lines: string[] = [];
  let cur = '';
  let overflow = false;
  for (const w of words) {
    if (cur && cur.length + 1 + w.length <= chars) {
      cur += ' ' + w;
      continue;
    }
    if (cur) lines.push(cur);
    if (lines.length === maxLines) {
      overflow = true;
      cur = '';
      break;
    }
    cur = w;
  }
  if (cur) lines.push(cur);
  if (overflow) {
    const last = lines[maxLines - 1]!;
    const room = chars - 1;
    lines[maxLines - 1] = last.slice(0, room).trimEnd() + '…';
  }
  return lines;
}

// Word-wrapped line count (>= ceil(len/34)) so wrapped text never clips.
function nodeHeight(fields: number, summary: string | undefined): number {
  const summaryLines = summary ? wrapSummary(summary).length : 0;
  return HEADER_HEIGHT + LINE_HEIGHT * (fields + summaryLines);
}

export async function layoutSpec(spec: Spec): Promise<Layout> {
  const layers = [...new Set(spec.nodes.map((n) => n.layer))];
  const children: ElkNode[] = layers.map((layer) => ({
    id: LAYER_PREFIX + layer,
    labels: [{ text: layer }],
    layoutOptions: { 'elk.padding': '[top=32,left=16,bottom=16,right=16]' },
    children: spec.nodes
      .filter((n) => n.layer === layer)
      .map((n) => ({
        id: n.id,
        width: NODE_WIDTH,
        height: nodeHeight(n.fields?.length ?? 0, n.summary),
      })),
  }));
  // Edges stay on the root so every section is in root (absolute) coordinates.
  const edges: ElkExtendedEdge[] = spec.edges.map((e, i) => ({
    id: `e${i}`,
    sources: [e.from],
    targets: [e.to],
    ...(e.label ? { labels: [{ text: e.label, width: e.label.length * 6, height: 14 }] } : {}),
  }));

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': '24',
      'elk.layered.spacing.nodeNodeBetweenLayers': '60',
    },
    children,
    edges,
  };
  // Lazy: elkjs costs ~70 ms to load and only the HTML path needs it.
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const root = await new ELK().layout(graph);

  const containerOrigin = new Map<string, Point>();
  const groups: LayoutGroup[] = [];
  const nodes: LayoutNode[] = [];
  for (const g of root.children ?? []) {
    const gx = g.x ?? 0;
    const gy = g.y ?? 0;
    containerOrigin.set(g.id, { x: gx, y: gy });
    groups.push({ layer: g.id.slice(LAYER_PREFIX.length), x: gx, y: gy, w: g.width ?? 0, h: g.height ?? 0 });
    for (const n of g.children ?? []) {
      nodes.push({ id: n.id, x: gx + (n.x ?? 0), y: gy + (n.y ?? 0), w: n.width ?? 0, h: n.height ?? 0 });
    }
  }

  const outEdges: LayoutEdge[] = (root.edges ?? []).map((e) => {
    const idx = Number(e.id.slice(1));
    const specEdge = spec.edges[idx]!;
    const sec = e.sections?.[0];
    const points = sec ? [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint] : [];
    // ELK reports section points in the frame of the edge's `container` (the common
    // ancestor), even for edges declared on the root.
    const origin = (e.container && containerOrigin.get(e.container)) || { x: 0, y: 0 };
    return {
      from: specEdge.from,
      to: specEdge.to,
      ...(specEdge.label ? { label: specEdge.label } : {}),
      points: points.map((p) => ({ x: p.x + origin.x, y: p.y + origin.y })),
    };
  });

  return { width: root.width ?? 0, height: root.height ?? 0, groups, nodes, edges: outEdges };
}
