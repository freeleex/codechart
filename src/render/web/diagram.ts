import { flagged, type CheckSummary } from '../terminal/check-lines.js';
import type { Drift } from '../drift.js';
import { checkNote, checkSection } from './check-html.js';
import { driftNote } from './drift-html.js';
import { esc, list, midpoint, num, renderPage, type HtmlMeta, type KeyPart } from './page.js';
import { SIDE_TITLE, SIDES, type Side } from './states.js';
import type { Point } from './layout.js';
import { COMPONENTS_VIEW, reviewControls, statusChips } from './tools.js';

/** The nodes an edge joins, for focus and the hover title. */
export interface EdgeEnds {
  from: string;
  to: string;
  title: string;
}

export const edgeEnds = (from: string, to: string, labelOf: (id: string) => string): EdgeEnds => ({ from, to, title: `${labelOf(from)} → ${labelOf(to)}` });

interface EdgeParts {
  ends: EdgeEnds;
  points: Point[];
  /** Arrowhead marker id. */
  marker: string;
  cls: string;
  label?: string;
  /** Where the label sits instead of the middle of the line. */
  labelAt?: Point;
  /** How far the label's box sits above the line point; its text follows. */
  lift: number;
}

export function renderEdgeSvg(e: EdgeParts): string {
  if (e.points.length < 2) return '';
  const d = e.points.map((p, i) => `${i ? 'L' : 'M'}${num(p.x)},${num(p.y)}`).join(' ');
  let out = `<path d="${d}" marker-end="url(#${e.marker})"/>`;
  if (e.label) {
    const m = e.labelAt ?? midpoint(e.points);
    const w = e.label.length * 5.6 + 6;
    out +=
      `<rect x="${num(m.x - w / 2)}" y="${num(m.y - e.lift)}" width="${num(w)}" height="12" rx="2"/>` +
      `<text x="${num(m.x)}" y="${num(m.y + 9 - e.lift)}">${esc(e.label)}</text>`;
  }
  return `<g class="${e.cls}" data-from="${esc(e.ends.from)}" data-to="${esc(e.ends.to)}"><title>${esc(e.ends.title)}</title>${out}</g>`;
}

interface InfoButtonText {
  label: string;
  title: string;
}

/** The header button that opens the page-info section; none when there is nothing to show. */
export function infoButton(check: CheckSummary | undefined, hasInfo: boolean, text: { mismatch: InfoButtonText; info: InfoButtonText }): string {
  const t = flagged(check) ? text.mismatch : hasInfo ? text.info : undefined;
  return t ? `<button id="info-toggle" type="button" aria-controls="page-info" title="${t.title}">${t.label}</button>` : '';
}

/** The page-info section: how to use the page, the check result, then the diagram's own notes. */
export function pageInfoSection(hint: string, sides: boolean, check: CheckSummary | undefined, ...notes: string[]): string {
  const panes = sides ? '; while "Panes: linked", both panes move together' : '';
  return `<section id="page-info"><p>${hint}${panes}.</p>${checkSection(check)}${notes.join('')}</section>`;
}

/** `kind` marks the list for the page's notes: what a note on one of its items is about. */
export const gapsHtml = (heading: string, items: string[] | undefined, kind: 'gap' | 'omitted'): string =>
  items?.length ? `<h3>${heading}</h3>${list(items, ` data-notes="${kind}"`)}` : '';

interface DiagramPage {
  title: string;
  meta: HtmlMeta;
  check: CheckSummary | undefined;
  /** A summary's drift from its plan, for the header. */
  drift?: Drift<unknown>;
  infoButton: string;
  /** The status of each node, for the header chips. */
  statuses: string[];
  /** An explain map: its only chip is Outside. */
  explain?: boolean;
  /** Two panes (Now / After) instead of one picture. */
  sides: boolean;
  paneKey: Record<Side, KeyPart[]>;
  /** Without `side`: the whole picture. */
  viewport: (side?: Side) => string;
  aside: string;
  width: number;
  height: number;
  extraCss?: string;
  extraDefs?: string;
  /** An explain map with flows: tab rows, and one canvas per view instead of `viewport`. */
  tabs?: string;
  views?: { id: string; title?: string; pane?: string; cls?: string; viewport: string; width: number; height: number }[];
}

export function renderDiagramPage(p: DiagramPage): string {
  return renderPage({
    title: p.title,
    meta: p.meta,
    infoButton: p.infoButton,
    headerNote: checkNote(p.check) + driftNote(p.drift),
    toolbar: statusChips(p.statuses, p.explain, p.views ? COMPONENTS_VIEW : undefined) + reviewControls(p.statuses.length),
    tabs: p.tabs,
    views: p.views,
    viewport: p.sides ? '' : p.views ? '' : p.viewport(),
    ...(p.sides ? { panes: SIDES.map((side) => ({ title: SIDE_TITLE[side], key: p.paneKey[side], viewport: p.viewport(side) })) } : {}),
    aside: p.aside,
    width: p.width,
    height: p.height,
    extraCss: p.extraCss,
    extraDefs: p.extraDefs,
  });
}
