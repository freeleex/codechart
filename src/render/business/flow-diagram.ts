import type { Flow } from '../../spec/business.js';
import { esc } from '../web/page.js';
import { layoutFlow, LINE, type FlowNode, type Pt } from './flow-layout.js';

const RADIUS = 7;
const MIN_SCALE = 0.8;

const num = (n: number): string => String(Math.round(n * 10) / 10);

/** A polyline with rounded elbows; the last segment stays straight so the arrowhead sits flat on the box. */
function pathOf(points: Pt[]): string {
  let d = `M${num(points[0]!.x)} ${num(points[0]!.y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1]!;
    const c = points[i]!;
    const n = points[i + 1]!;
    const r = Math.min(RADIUS, Math.hypot(c.x - p.x, c.y - p.y) / 2, Math.hypot(n.x - c.x, n.y - c.y) / 2);
    const back = Math.hypot(c.x - p.x, c.y - p.y) || 1;
    const fwd = Math.hypot(n.x - c.x, n.y - c.y) || 1;
    d += ` L${num(c.x + ((p.x - c.x) / back) * r)} ${num(c.y + ((p.y - c.y) / back) * r)} Q${num(c.x)} ${num(c.y)} ${num(c.x + ((n.x - c.x) / fwd) * r)} ${num(c.y + ((n.y - c.y) / fwd) * r)}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L${num(last.x)} ${num(last.y)}`;
}

function shape(n: FlowNode): string {
  const x = n.cx - n.w / 2;
  const y = n.cy - n.h / 2;
  if (n.kind === 'question') return `<path class="shape" d="M${num(n.cx)} ${num(y)} L${num(x + n.w)} ${num(n.cy)} L${num(n.cx)} ${num(y + n.h)} L${num(x)} ${num(n.cy)}Z"/>`;
  return `<rect class="shape" x="${num(x)}" y="${num(y)}" width="${n.w}" height="${n.h}" rx="${n.kind === 'end' ? n.h / 2 : 8}"/>`;
}

const textOf = (lines: string[], cx: number, cy: number, cls: string, anchor = 'middle'): string =>
  `<text class="${cls}" text-anchor="${anchor}">${lines.map((l, i) => `<tspan x="${num(cx)}" y="${num(cy - (lines.length * LINE) / 2 + LINE * (i + 0.78))}">${esc(l)}</tspan>`).join('')}</text>`;

function node(n: FlowNode): string {
  const note = n.reading ? " (the agent's reading, not checked in code)" : '';
  return `<g class="fn ${n.kind}${n.reading ? ' guess' : ''}" id="i-${esc(n.id)}"><title>${esc(n.text + note)}</title>${shape(n)}${textOf(n.lines, n.cx, n.cy, 'nt')}</g>`;
}

/** The flow as server-drawn inline SVG: one band per lane, a node per step; it shrinks with the page down to 80%, then scrolls. */
export function flowDiagram(flow: Flow): string {
  const layout = layoutFlow(flow);
  const { width, height } = layout;
  const lanes = layout.lanes
    .map((l, i) => `<rect class="band b${i % 2}" x="0" y="${num(l.top)}" width="${width}" height="${num(l.height)}"/>${textOf(l.lines, 14, l.top + l.height / 2, 'lane', 'start')}`)
    .join('');
  const edges = layout.edges
    .map((e) => `<path class="edge" d="${pathOf(e.points)}" marker-end="url(#flow-arrow)"/>${e.label ? `<text class="elab h${e.label.lane % 2}" x="${num(e.label.at.x)}" y="${num(e.label.at.y)}" text-anchor="${e.label.anchor}">${esc(e.label.text)}</text>` : ''}`)
    .join('');
  const label = `Flow of ${flow.steps.length} ${flow.steps.length === 1 ? 'step' : 'steps'} across ${flow.lanes.map((l) => l.name).join(', ')}: ${flow.steps.map((s) => s.text).join('; ')}`;
  return `<div class="card flowbox"><svg class="flow" role="img" aria-label="${esc(label)}" viewBox="0 0 ${width} ${num(height)}" width="${width}" height="${num(height)}" style="min-width:${Math.round(width * MIN_SCALE)}px;max-width:${width}px">
<defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path class="ah" d="M0 0L10 5L0 10z"/></marker></defs>
${lanes}${edges}${layout.nodes.map(node).join('')}</svg></div>`;
}

