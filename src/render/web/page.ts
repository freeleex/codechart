import { createHash } from 'node:crypto';
import { THEMES, type Theme } from '../../config/schema.js';
import { CSS } from './styles.js';
import { CLIENT_JS } from './client.js';
import type { Point } from './layout.js';
import { stripInvisible } from '../strip.js';

export type { Theme };

export interface HtmlMeta {
  generatedAt: Date;
  repo: string;
  theme?: Theme;
}

export function esc(s: string): string {
  return stripInvisible(s)
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

interface PageParts {
  title: string;
  meta: HtmlMeta;
  infoButton: string;
  viewport: string;
  aside: string;
  width: number;
  height: number;
  extraCss?: string;
  extraDefs?: string;
}

const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${createHash('sha256').update(CLIENT_JS).digest('base64')}'; img-src data:; base-uri 'none'; form-action 'none'`;

export function renderPage(p: PageParts): string {
  const theme: Theme = p.meta.theme && THEMES.includes(p.meta.theme) ? p.meta.theme : 'auto';
  const data = { width: p.width, height: p.height };
  return `<!doctype html>
<html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${esc(p.title)}</title>
<style>${CSS}${p.extraCss ?? ''}</style></head>
<body>
<header><h1>${esc(p.title)}</h1><span class="meta">${esc(p.meta.repo)} · ${esc(p.meta.generatedAt.toISOString())}</span>${p.infoButton}<button id="theme-toggle" type="button" title="Cycle theme: auto, light, dark"></button></header>
<main>
<div id="canvas"><svg><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker>${p.extraDefs ?? ''}</defs>
<g id="viewport">${p.viewport}</g></svg></div>
<aside>${p.aside}</aside>
</main>
<script type="application/json" id="spec-data">${jsonForScript(data)}</script>
<script>${CLIENT_JS}</script>
</body></html>
`;
}
