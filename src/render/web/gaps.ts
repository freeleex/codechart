import type { Spec, SpecNode } from '../../spec/schema.js';
import type { Box } from './shapes.js';
import type { MapCheck } from '../check.js';
import { entryPaths, entryProse, entryWords } from '../omitted.js';
import { cardShape } from './shapes.js';
import { headerHeight, KIND_ROW, LABEL_LINE_HEIGHT, labelLines, LINE_HEIGHT, wrapSummary } from './layout.js';
import { esc } from './page.js';
import { panelShell, panelTitle } from './tools.js';

/** A few plain words are the reason a group of omitted files gets a box: a bare `tests:` or `docs:` list stays in the page info. */
const MIN_REASON_WORDS = 3;

/** An omitted group the page draws as a dashed box in the area of the folder it names. */
export interface GapBox {
  /** The entry's place in `spec.omitted`. */
  entry: number;
  /** The entry as written. */
  text: string;
  /** A unique id no node uses, for the box's panel and selection. */
  id: string;
  /** The area whose nodes sit in the same top-level folder; the folder itself when none does. */
  layer: string;
  /** The entry without its paths: what it says these files are or why they are off the map. */
  prose: string;
  /** The entry's path tokens this box stands for. */
  paths: string[];
  /** Changed files the entry explains in this area; empty without a diff. */
  files: string[];
  /** False when the page was rendered without a diff, so `files` says nothing. */
  filesKnown: boolean;
}

const topOf = (path: string): string => (path.includes('/') ? path.slice(0, path.indexOf('/')) : '');

/** The layer most nodes under each top-level folder use; a folder no node names has none. */
function folderLayers(spec: Spec, found: Map<string, string>): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();
  for (const node of spec.nodes) {
    const path = found.get(node.id) ?? node.path;
    const top = path === undefined ? '' : topOf(path);
    if (top === '') continue;
    const byLayer = votes.get(top) ?? new Map<string, number>();
    byLayer.set(node.layer, (byLayer.get(node.layer) ?? 0) + 1);
    votes.set(top, byLayer);
  }
  const out = new Map<string, string>();
  for (const [top, byLayer] of votes) out.set(top, [...byLayer].sort((a, b) => b[1] - a[1])[0]![0]);
  return out;
}

const safeId = (s: string): string => s.replace(/[^\w-]/g, '_');

/**
 * The dashed boxes for `omitted` entries that name a folder and say why it is off the map. An entry that only
 * lists files (`tests: …`, `docs: …`) is no box: it stays a page-info item, as before.
 */
export function gapBoxes(spec: Spec, check?: MapCheck, takenIds: readonly string[] = []): GapBox[] {
  const omitted = spec.omitted ?? [];
  if (!omitted.length) return [];
  const layers = folderLayers(spec, check?.found ?? new Map());
  const taken = new Set([...spec.nodes.map((n) => n.id), ...takenIds]);
  const out: GapBox[] = [];
  omitted.forEach((text, entry) => {
    if (entryWords(text).length < MIN_REASON_WORDS) return;
    const groups = new Map<string, string[]>();
    for (const path of entryPaths(text)) {
      const top = topOf(path);
      if (top === '') continue;
      groups.set(top, [...(groups.get(top) ?? []), path]);
    }
    for (const [top, paths] of groups) {
      let id = `omitted-${entry}${groups.size > 1 ? `-${safeId(top)}` : ''}`;
      while (taken.has(id)) id += 'x';
      taken.add(id);
      const files = (check?.explained?.[entry] ?? []).filter((f) => topOf(f) === top);
      out.push({
        entry,
        text,
        id,
        layer: layers.get(top) ?? top,
        prose: entryProse(text),
        paths,
        files,
        filesKnown: check?.explained !== undefined,
      });
    }
  });
  return out;
}

/** The spec with a virtual box per gap, to lay out and draw; the spec itself is unchanged. */
export function withGaps(spec: Spec, gaps: readonly GapBox[]): Spec {
  if (!gaps.length) return spec;
  const nodes: SpecNode[] = gaps.map((g) => ({
    id: g.id,
    label: g.prose,
    kind: 'other',
    status: 'context',
    layer: g.layer,
    summary: g.paths.join(' '),
  }));
  return { ...spec, nodes: [...spec.nodes, ...nodes] };
}

const BADGE = (n: number): string => `${n} changed`;

const hover = (g: GapBox): string =>
  `Left off the map: ${g.prose}${g.files.length ? ` (${g.files.length} changed ${g.files.length === 1 ? 'file' : 'files'} covered)` : ''}.`;

/** The dashed card on the canvas: what the entry says it is, over the paths it names. */
export function gapSvg(g: GapBox, box: Box): string {
  const x = Math.round(box.x * 10) / 10;
  const y = Math.round(box.y * 10) / 10;
  const head = headerHeight(g.prose);
  const lines: string[] = [];
  let row = head;
  for (const line of wrapSummary(g.paths.join(' '))) {
    lines.push(`<text class="summary" x="${x + 8}" y="${y + row + 12}">${esc(line)}</text>`);
    row += LINE_HEIGHT;
  }
  const height = Math.max(row, Math.round(box.h * 10) / 10);
  const top = y + 18 + KIND_ROW;
  return (
    `<g class="node gap" data-id="${esc(g.id)}" data-label="${esc(g.prose)}" tabindex="0" role="button" aria-label="${esc(hover(g))}">` +
    `<title>${esc(hover(g))}</title>` +
    cardShape('other', { x, y, w: box.w, h: height }, head).svg +
    `<line class="head" x1="${x}" y1="${y + head}" x2="${x + box.w}" y2="${y + head}"/>` +
    `<text class="kind" x="${x + 8}" y="${y + 12}">omitted</text>` +
    labelLines(g.prose)
      .map((line, i) => `<text class="label" x="${x + 8}" y="${top + i * LABEL_LINE_HEIGHT}">${esc(line)}</text>`)
      .join('') +
    (g.files.length ? `<text class="badge" x="${x + box.w - 8}" y="${top}">${BADGE(g.files.length)}</text>` : '') +
    lines.join('') +
    `</g>`
  );
}

const GAP_WHY =
  'The agent named these files under “Not on map” instead of drawing each as a box: too many, or not worth a box. A change summary\'s check counts them as covered by that entry.';

/** The box's panel: the entry, and the changed files it covers (when the page was rendered with a diff). */
export function gapPanel(g: GapBox): string {
  let out = panelTitle(g.id, 'Left off the map', false, g.text);
  out += `<p class="mismatch-why">${esc(GAP_WHY)}</p>`;
  if (!g.filesKnown) {
    out += '<p class="mismatch-why">No diff is checked for this page, so the changed files it covers are not listed.</p>';
  } else if (g.files.length) {
    out += `<h3>Changed files it covers (${g.files.length})</h3><ul>${g.files.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`;
  } else {
    out += '<p class="mismatch-why">No changed file in the diff falls under this entry.</p>';
  }
  return `<template class="card-panel" data-for="${esc(g.id)}"><div class="gap-panel">${panelShell(out, '')}</div></template>`;
}
