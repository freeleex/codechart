import type { NodeKind } from '../../spec/schema.js';

export const ICON: Partial<Record<NodeKind, string>> = {
  endpoint: '⇄',
  service: '⚙',
  component: '▣',
  table: '▤',
  model: '◉',
  enum: '◇',
  config: '⚑',
  file: '≡',
};

const FOLD = 12;
const CUT = 9;
const TAG = 11;
const PILL_MAX = 19;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Text insets [left, right] that clear a pill's curve, a tag's point and a component's rails. */
export const INSET: Partial<Record<NodeKind, [number, number]>> = { endpoint: [18, 18], config: [17, 8], component: [14, 14] };

/** Where the tickbox and the flag sit, so they stay on a cut or curved corner. */
export interface Anchors {
  tick: [number, number];
  flag: [number, number];
}

const cardOf = (attrs: string): string => `<rect class="card" ${attrs}/>`;
const deco = (d: string): string => `<path class="deco" d="${d}"/>`;

/** The card outline per kind: endpoint pill, service round, component rails, table column ticks, model double line, enum cut corners, config tag, file fold, else plain. */
export function cardShape(kind: NodeKind, { x, y, w, h }: Box, head: number): { svg: string; anchors: Anchors } {
  const r = x + w;
  const plain: Anchors = { tick: [x, y], flag: [r, y] };
  const rect = (rx: number) => cardOf(`x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"`);
  switch (kind) {
    case 'endpoint': {
      const rx = Math.min(h / 2, PILL_MAX);
      const arc = Math.round(rx * 0.29 * 10) / 10;
      return { svg: rect(rx), anchors: { tick: [x + arc, y + arc], flag: [r - arc, y + arc - 4] } };
    }
    case 'service':
      return { svg: rect(12), anchors: plain };
    case 'component':
      return { svg: rect(2) + deco(`M${x + 6},${y} V${y + h} M${r - 6},${y} V${y + h}`), anchors: plain };
    case 'table': {
      const ticks = [0.25, 0.5, 0.75].map((f) => `M${Math.round((x + w * f) * 10) / 10},${y + head - 6} V${y + head}`).join(' ');
      return { svg: rect(6) + deco(ticks), anchors: plain };
    }
    case 'model':
      return { svg: rect(6) + `<line class="head" x1="${x}" y1="${y + head - 3}" x2="${r}" y2="${y + head - 3}"/>`, anchors: plain };
    case 'enum': {
      const d = `M${x + CUT},${y} H${r - CUT} L${r},${y + CUT} V${y + h - CUT} L${r - CUT},${y + h} H${x + CUT} L${x},${y + h - CUT} V${y + CUT} Z`;
      return { svg: `<path class="card" d="${d}"/>`, anchors: { ...plain, tick: [x + CUT / 2, y + CUT / 2], flag: [r - CUT / 2, y + CUT / 2 - 4] } };
    }
    case 'config': {
      const d = `M${x + TAG},${y} H${r} V${y + h} H${x + TAG} L${x},${y + h / 2} Z`;
      return { svg: `<path class="card" d="${d}"/>`, anchors: { ...plain, tick: [x + TAG, y] } };
    }
    case 'file':
      return {
        svg: `<path class="card" d="M${x},${y} H${r - FOLD} L${r},${y + FOLD} V${y + h} H${x} Z"/><path class="fold" d="M${r - FOLD},${y} V${y + FOLD} H${r}"/>`,
        anchors: { ...plain, flag: [r - FOLD - 6, y] },
      };
    default:
      return { svg: rect(6), anchors: plain };
  }
}
