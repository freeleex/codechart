import { createHash } from 'node:crypto';
import { THEMES, type Theme } from '../../config/schema.js';
import { CSS } from './styles.js';
import { CLIENT_JS } from './client.js';
import type { Point } from './layout.js';
import { stripInvisible } from '../strip.js';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "6 Nov 2026, 19:34" in the local time of the machine that built the page. */
export function prettyDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
  /** What changed in it, for the header note's tooltip. */
  updateNotes?: string[];
  /** The review file this page is paired with; without it the page takes no notes. `at` is that file's `renderedAt`. */
  change?: { slug: string; branch: string; at: string };
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

export function jsonForScript(v: unknown): string {
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

export function list(items: string[], attrs = ''): string {
  return `<ul${attrs}>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
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
  /** Tab rows under the header, already HTML. */
  tabs?: string;
  /** Instead of `viewport`: one canvas per view, one shown at a time (two with side by side); `cls` is added to its section, `pane` names a view that has no `title`. */
  views?: { id: string; title?: string; pane?: string; cls?: string; viewport: string; width: number; height: number }[];
  /** Instead of `viewport`: canvases side by side that pan and zoom together while linked. */
  panes?: { title: string; key: KeyPart[]; viewport: string }[];
  aside: string;
  width: number;
  height: number;
  extraCss?: string;
  extraDefs?: string;
}

const KEY_HELP = ['n / p: next / previous hunk (opens it, folds the others)', '] / [: next / previous unreviewed node', 'r: toggle reviewed', 'o / O: fold this hunk / toggle all hunks', 'f: zoom to the selected node', '?: this help'];
const NOTE_KEY_HELP = 'c: add a note to the selected node';

export const PAGE_CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${createHash('sha256').update(CLIENT_JS).digest('base64')}'; img-src data:; base-uri 'none'; form-action 'none'`;

/** A view's section: its canvas, under a title that shows only with side by side. */
function viewSection(v: NonNullable<PageParts['views']>[number], i: number): string {
  const title = v.title ?? v.pane;
  return `<section class="view${v.cls ?? ''}" data-view="${esc(v.id)}"${v.title === undefined ? '' : ` data-title="${esc(v.title)}"`}${i ? ' hidden' : ''}>${title === undefined ? '' : `<div class="pane-title">${esc(title)}</div>`}<div class="canvas"><svg>\n<g class="viewport">${v.viewport}</g></svg></div></section>`;
}

export function renderPage(p: PageParts): string {
  const theme: Theme = p.meta.theme && THEMES.includes(p.meta.theme) ? p.meta.theme : 'auto';
  const data = { width: p.width, height: p.height, repoKey: p.meta.repoKey ?? p.meta.repo, ...(p.views && { views: p.views.map(({ id, width, height }) => ({ id, width, height })) }), ...(p.meta.change && { change: p.meta.change }) };
  const defs = `<defs>${arrowMarker('arrow')}${p.extraDefs ?? ''}</defs>`;
  // Ids are document-wide, so the second pane's url(#arrow) finds the first pane's defs.
  const canvas = (viewport: string, i: number) =>
    `<div class="canvas"${p.panes ? '' : ' id="canvas"'}><svg>${i === 0 ? defs : ''}\n<g class="viewport">${viewport}</g></svg></div>`;
  const body = p.views
    ? `<div id="viewpanes">${p.views.map(viewSection).join('\n')}</div>`
    : p.panes
    ? `<div id="panes">${p.panes.map((pane, i) => `<section class="pane" aria-label="${esc(pane.title)}"><div class="pane-title">${esc(pane.title)}<span class="pane-key"> · ${keyHtml(pane.key)}</span></div>${canvas(pane.viewport, i)}</section>`).join('')}</div>`
    : canvas(p.viewport, 0);
  return `<!doctype html>
<html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">
<title>${esc(p.title)}</title>
<style>${CSS}${p.extraCss ?? ''}</style></head>
<body>
${p.views ? `<svg class="defs" aria-hidden="true">${defs}</svg>\n` : ''}<header><h1>${esc(p.title)}</h1>${p.headerNote ?? ''}<span class="meta">${esc(p.meta.repo)} · <time datetime="${p.meta.generatedAt.toISOString()}" title="${p.meta.generatedAt.toISOString()}">${prettyDate(p.meta.generatedAt)}</time></span>${p.meta.update ? `<span class="update" title="${esc(['A newer codechart is out', ...(p.meta.updateNotes ?? []).map((n) => `- ${n}`)].join('\n'))}">codechart ${esc(p.meta.update)} is out: run <code>codechart update</code></span>` : ''}${p.infoButton}${p.panes ? '<button id="link-toggle" type="button" title="Linked: panning or zooming one pane moves both"></button>' : ''}<button id="theme-toggle" type="button" title="Cycle theme: auto, light, dark"></button></header>
${p.tabs ?? ''}${p.toolbar ? `<div id="toolbar">${p.toolbar}</div>\n` : ''}<main>
${body}
<div id="resize" role="separator" aria-orientation="vertical" aria-label="Resize panel" tabindex="0" title="Drag to resize the panel"></div>
<aside><div id="aside-scroll"><nav id="panel-nav" aria-label="Panel history"><button id="nav-focus" type="button" disabled aria-label="Focus node (f)" title="Focus node (f)">◎</button><button id="nav-back" type="button" disabled aria-label="Back" title="Back (Alt+←)">←</button><button id="nav-forward" type="button" disabled aria-label="Forward" title="Forward (Alt+→)">→</button></nav>${p.aside}</div><div id="panel-rel" hidden></div></aside>
</main>
<div id="key-help" role="dialog" aria-label="Keys" hidden><b>Keys</b>${(p.meta.change ? [...KEY_HELP.slice(0, -1), NOTE_KEY_HELP, KEY_HELP.at(-1)!] : KEY_HELP).map((k) => `<div>${esc(k)}</div>`).join('')}</div>
<script type="application/json" id="spec-data">${jsonForScript(data)}</script>
<script>${CLIENT_JS}</script>
</body></html>
`;
}
