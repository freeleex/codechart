import { createHash } from 'node:crypto';
import { THEMES, type Theme } from '../../config/schema.js';
import { CSS } from './styles.js';
import { CLIENT_JS } from './client.js';
import type { Point } from './layout.js';
import { stripInvisible } from '../strip.js';

export type { Theme };

export interface HtmlMeta {
  generatedAt: Date;
  /** Shown in the header. */
  repo: string;
  /** What saved ticks are filed under; unlike `repo`, tells same-named repos apart. Defaults to `repo`. */
  repoKey?: string;
  theme?: Theme;
  /** A newer codechart version, known from the last daily check. */
  update?: string;
}

export function esc(s: string): string {
  return stripInvisible(s)
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsonForScript(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export const num = (n: number): string => String(Math.round(n * 10) / 10);

export const arrowMarker = (id: string): string =>
  `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker>`;

/** Arrowheads in the colour of a link the plan adds or removes. */
export const CHANGE_ARROWS = arrowMarker('arrow-added') + arrowMarker('arrow-removed');

export function list(items: string[]): string {
  return `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

export function midpoint(points: Point[]): Point {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  let rest = total / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len >= rest && len > 0) {
      const f = rest / len;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    rest -= len;
  }
  return points[0] ?? { x: 0, y: 0 };
}

/** One entry of a pane's colour key, in that colour. */
export interface KeyPart {
  text: string;
  tone: 'rem' | 'new' | 'chg' | 'cfg';
}

const keyHtml = (key: KeyPart[]) => key.map((k) => `<span class="k-${k.tone}">${esc(k.text)}</span>`).join(' · ');

interface PageParts {
  title: string;
  meta: HtmlMeta;
  infoButton: string;
  /** Escaped already. */
  headerNote?: string;
  /** The row under the header: status chips and review progress, already HTML. */
  toolbar?: string;
  viewport: string;
  /** Instead of `viewport`: canvases side by side that pan and zoom together while linked. */
  panes?: { title: string; key: KeyPart[]; viewport: string }[];
  aside: string;
  width: number;
  height: number;
  extraCss?: string;
  extraDefs?: string;
}

const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${createHash('sha256').update(CLIENT_JS).digest('base64')}'; img-src data:; base-uri 'none'; form-action 'none'`;

export function renderPage(p: PageParts): string {
  const theme: Theme = p.meta.theme && THEMES.includes(p.meta.theme) ? p.meta.theme : 'auto';
  const data = { width: p.width, height: p.height, repoKey: p.meta.repoKey ?? p.meta.repo };
  const defs = `<defs>${arrowMarker('arrow')}${p.extraDefs ?? ''}</defs>`;
  // Ids are document-wide, so the second pane's url(#arrow) finds the first pane's defs.
  const canvas = (viewport: string, i: number) =>
    `<div class="canvas"${p.panes ? '' : ' id="canvas"'}><svg>${i === 0 ? defs : ''}\n<g class="viewport">${viewport}</g></svg></div>`;
  const body = p.panes
    ? `<div id="panes">${p.panes.map((pane, i) => `<section class="pane" aria-label="${esc(pane.title)}"><div class="pane-title">${esc(pane.title)}<span class="pane-key"> · ${keyHtml(pane.key)}</span></div>${canvas(pane.viewport, i)}</section>`).join('')}</div>`
    : canvas(p.viewport, 0);
  return `<!doctype html>
<html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${esc(p.title)}</title>
<style>${CSS}${p.extraCss ?? ''}</style></head>
<body>
<header><h1>${esc(p.title)}</h1>${p.headerNote ?? ''}<span class="meta">${esc(p.meta.repo)} · ${esc(p.meta.generatedAt.toISOString())}</span>${p.meta.update ? `<span class="update" title="A newer codechart is out">codechart ${esc(p.meta.update)} is out: run <code>codechart update</code></span>` : ''}${p.infoButton}${p.panes ? '<button id="link-toggle" type="button" title="Linked: panning or zooming one pane moves both"></button>' : ''}<button id="theme-toggle" type="button" title="Cycle theme: auto, light, dark"></button></header>
${p.toolbar ? `<div id="toolbar">${p.toolbar}</div>\n` : ''}<main>
${body}
<div id="resize" role="separator" aria-orientation="vertical" aria-label="Resize panel" tabindex="0" title="Drag to resize the panel"></div>
<aside><nav id="panel-nav" aria-label="Panel history"><button id="nav-back" type="button" disabled aria-label="Back" title="Back (Alt+←)">←</button><button id="nav-forward" type="button" disabled aria-label="Forward" title="Forward (Alt+→)">→</button></nav>${p.aside}</aside>
</main>
<script type="application/json" id="spec-data">${jsonForScript(data)}</script>
<script>${CLIENT_JS}</script>
</body></html>
`;
}
