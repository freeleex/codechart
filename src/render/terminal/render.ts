import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Spec } from '../../spec/schema.js';
import type { TermCtx } from './ctx.js';
import { flat, truncate, wrapItems } from './wrap.js';
import { renderFieldLines } from './fields.js';
import { selectTerminalNodes } from './select.js';
import { marker, paint, plainLabel } from './labels.js';
import { linksAmong, renderLinks } from './links.js';
import { alertLine, countLines, type CheckSummary } from './check-lines.js';

interface TerminalOptions {
  maxNodes: number;
  width?: number;
  htmlPath?: string;
  color: boolean;
  keyLine?: boolean;
  check?: CheckSummary;
}

export const MIN_WIDTH = 20;
const MAX_WIDTH = 100;
const NOT_TTY_WIDTH = 80;
const MAX_ENV_WIDTH = 300;
const KEY_ORDER = ['new', 'removed', 'changed', 'context', 'config'] as const;
export const KEY = `key: ${KEY_ORDER.map((s) => `${marker(s)} ${s}`).join('  ')}`;

export const fullMapLine = (htmlPath: string): string => `full map → ${pathToFileURL(resolve(htmlPath)).href}`;

export function defaultWidth(
  stdout: { isTTY?: boolean; columns?: number } = process.stdout,
  env: Record<string, string | undefined> = process.env,
): number {
  if (stdout.isTTY) return Math.min(stdout.columns || MAX_WIDTH, MAX_WIDTH);
  const fromEnv = Math.floor(Number(env.COLUMNS));
  return Number.isFinite(fromEnv) && fromEnv > 0 && fromEnv <= MAX_ENV_WIDTH ? fromEnv : NOT_TTY_WIDTH;
}

function footer(spec: Spec, hidden: number, { width, htmlPath, check }: TermCtx, keyLine: boolean): string {
  const count = (status: string) => spec.nodes.filter((n) => n.status === status).length;
  const removed = count('removed') > 0 ? ` · ${count('removed')} removed` : '';
  const lines = [
    countLines(`${spec.nodes.length} nodes · ${count('new')} new · ${count('changed')} changed${removed} · ${count('config')} config`, check, width),
  ];
  if (keyLine) lines.push(truncate(KEY, width));
  if (spec.gaps?.length) lines.push(wrapItems('gaps: ', spec.gaps.map(flat), width));
  if (spec.omitted?.length) lines.push(wrapItems('not on map: ', spec.omitted.map(flat), width));
  if (hidden > 0) lines.push(truncate(`+${hidden} more ${htmlPath ? 'in web view' : 'not shown'}`, width));
  // Never broken: a split URL stops being clickable.
  if (htmlPath) lines.push(fullMapLine(htmlPath));
  return lines.join('\n');
}

export function renderTerminal(spec: Spec, opts: TerminalOptions): string {
  return renderTerminalDetailed(spec, opts).text;
}

/** `truncated`: a label, edge label, target, layer or field head was cut with `…`. */
export function renderTerminalDetailed(spec: Spec, opts: TerminalOptions): { text: string; truncated: boolean } {
  const width = Math.max(opts.width ?? defaultWidth(), MIN_WIDTH);
  const ctx: TermCtx = { width, color: opts.color, cuts: { truncated: false }, htmlPath: opts.htmlPath, check: opts.check };
  const { ids, hidden } = selectTerminalNodes(spec, opts.maxNodes);

  const sections: string[] = [];
  const alert = alertLine(opts.check, width);
  if (alert) sections.push(alert);
  const links = renderLinks(spec, ids, ctx);
  if (links) sections.push(links);
  const shown = new Set(linksAmong(spec, ids).flatMap((e) => [e.from, e.to]));
  const lone = spec.nodes.filter((n) => ids.has(n.id) && !shown.has(n.id));
  const items = lone.map((n) => ({
    text: plainLabel(n),
    paint: opts.color ? (piece: string) => paint(n, piece) : undefined,
  }));
  if (items.length > 0) sections.push(wrapItems('also: ', items, width));
  if (!opts.htmlPath) {
    const fields = renderFieldLines(spec, ids, ctx);
    if (fields) sections.push(fields);
  }
  sections.push(footer(spec, hidden, ctx, opts.keyLine ?? true));
  return { text: `${sections.join('\n\n')}\n`, truncated: ctx.cuts.truncated };
}
