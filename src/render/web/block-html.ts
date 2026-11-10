import { codeRow, pathHtml } from '../flow/html.js';
import type { Block } from '../block.js';
import { esc } from './page.js';

const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;

const rows = (b: Block, from: number, to: number) =>
  b.lines
    .slice(from, to)
    .map((l, i) => codeRow(b.first + from + i, esc(l), from + i === b.hit ? 'hit' : undefined))
    .join('\n');

/** A run of lines behind a button that opens it in place (the diff panel's unchanged-lines row); `note` closes the opened run where the page stops embedding. */
function fold(label: string, body: string, note: string, noteFirst: boolean): string {
  if (body === '') return '';
  const cut = note ? `<span class="gap gap-out">${note}</span>` : '';
  return (
    `<span class="cgap"><button type="button" class="gap gap-run" aria-expanded="false">⋯ ${label}</button>` +
    `<span class="gap-rows">${noteFirst ? cut + body : body + cut}</span></span>`
  );
}

/** The code of an explain box: the block around its quoted line open, the lines before and after folded. */
export function blockHtml(b: Block): string {
  const hit = b.hit === undefined ? undefined : b.first + b.hit;
  const before = b.above + b.from;
  const after = b.below + (b.lines.length - b.to);
  const cut = (n: number, where: string) => (n > 0 ? `⋯ ${plural(n, 'line')} ${where} not shown` : '');
  return (
    `<div class="path">${pathHtml(hit === undefined ? b.path : `${b.path}:${hit}`)}</div>` +
    `<div class="snippet block">` +
    fold(`${plural(before, 'line')} above`, rows(b, 0, b.from), cut(b.above, 'above'), true) +
    `<code>${rows(b, b.from, b.to)}</code>` +
    fold(`${plural(after, 'more line')}`, rows(b, b.to, b.lines.length), cut(b.below, 'below'), false) +
    `</div>`
  );
}
