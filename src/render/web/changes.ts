import { codeRow, pathHtml } from '../flow/html.js';
import type { Preview } from '../preview.js';
import { esc } from './page.js';

/** A run of this many unchanged lines inside a hunk collapses into one clickable row. */
const GAP_MIN = 4;

type Line = Preview['lines'][number];

const MARK = { add: '+', del: '-', ctx: ' ' } as const;
const HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

interface Header {
  start: number;
  count: number;
  fn: string;
}

function hunksOf(lines: Line[]): Line[][] {
  const out: Line[][] = [];
  for (const l of lines) {
    if (l.kind === 'hunk') out.push([l]);
    else out.at(-1)?.push(l);
  }
  return out;
}

function headerOf(rows: Line[]): Header | undefined {
  const m = HEADER.exec(rows[0]!.text);
  return m ? { start: Number(m[1]), count: m[2] === undefined ? 1 : Number(m[2]), fn: m[3] ?? '' } : undefined;
}

/** First and last new-file line a hunk covers; a pure deletion (`+5,0`) sits after line 5 and covers none. */
const span = (h: Header): [number, number] => (h.count === 0 ? [h.start + 1, h.start] : [h.start, h.start + h.count - 1]);

const PAGER =
  '<div class="pager" role="group" aria-label="Hunks">' +
  '<button type="button" class="pg-prev" aria-label="Previous hunk" title="Previous hunk (p)">‹</button>' +
  '<span class="pg-count" role="status" aria-label="{n} hunks">– / {n}</span>' +
  '<button type="button" class="pg-next" aria-label="Next hunk" title="Next hunk (n)">›</button>' +
  '<button type="button" class="pg-all pg-expand" aria-label="Expand all" title="Expand all hunks">+ all</button>' +
  '<button type="button" class="pg-all pg-collapse" aria-label="Collapse all" title="Collapse all hunks">− all</button>' +
  '<button type="button" class="pg-keys" aria-label="Show keys" title="Keys">? keys</button></div>';

const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;
const count = (n: number) => plural(n, 'changed line');
const counts = (add: number, del: number, cls: string) => `<span class="${cls}"><span class="n-add">+${add}</span> <span class="n-del">−${del}</span></span>`;

const tally = (rows: Line[]) => ({ add: rows.filter((l) => l.kind === 'add').length, del: rows.filter((l) => l.kind === 'del').length });

/** The row above a hunk that folds it: function context and counts; folded, it also gives the first change. */
function head(rows: Line[]): string {
  const h = headerOf(rows);
  const body = rows.slice(1);
  const { add, del } = tally(body);
  const first = body.find((l) => l.kind !== 'ctx');
  return (
    `<button type="button" class="hunk-sum hh" aria-expanded="false"><span class="caret" aria-hidden="true"></span>` +
    (h ? `<span class="hs-ln">L${h.start}</span>` : '') +
    (h?.fn ? `<span class="hs-fn">${esc(h.fn)}</span>` : '') +
    (first ? `<span class="hs-first">${esc(MARK[first.kind as 'add' | 'del'] + first.text.trim())}</span>` : '') +
    `${counts(add, del, 'hs-stat')}</button>`
  );
}

/** What lies between the previous hunk and this one (or the top of the file) and is not in the diff. Nothing is embedded, so it can't open. */
function outside(prev: Header | undefined, cur: Header | undefined): string {
  if (!cur) return '';
  const n = span(cur)[0] - (prev ? span(prev)[1] : 0) - 1;
  if (n <= 0) return '';
  return `<div class="gap gap-out">⋯ ${plural(n, 'line')} ${prev ? 'not in the diff' : 'above'}</div>`;
}

const rowsHtml = (rows: Line[]) => rows.map((l) => codeRow(l.n, esc(l.text), `d-${l.kind}`, MARK[l.kind as keyof typeof MARK])).join('\n');

/** The rows after the header; a run of unchanged lines long enough to skip becomes a button that opens it in place. */
function bodyHtml(rows: Line[]): string {
  const out: string[] = [];
  let j = 1;
  while (j < rows.length) {
    let k = j;
    while (k < rows.length && rows[k]!.kind === 'ctx') k++;
    if (k - j >= GAP_MIN) {
      out.push(
        `<span class="cgap"><button type="button" class="gap gap-run" aria-expanded="false">\u22ef ${plural(k - j, 'unchanged line')}</button>` +
          `<span class="gap-rows">${rowsHtml(rows.slice(j, k))}</span></span>`,
      );
      j = k;
    } else {
      out.push(rowsHtml([rows[j]!]));
      j++;
    }
  }
  return out.join('\n');
}

/** Totals for the Changes heading; a capped file only knows its changed-line total. */
function totals(p: Preview): string {
  const { add, del } = tally(p.lines);
  return p.rows > p.lines.length ? `<span class="fh-stat">${count(p.total)}</span>` : counts(add, del, 'fh-stat');
}

/** Same file as the node's own path (which may carry `:line`), already shown under the panel title. */
const samePath = (p: Preview, nodePath: string | undefined) => nodePath?.replace(/:\d+(?:-\d+)?$/, '').replace(/^\.\//, '') === p.path;

/** The Changes section of a node panel: the hunks, foldable. `nodePath`: the path the panel already shows, so the file is named only when it differs. */
export function changesHtml(p: Preview, nodePath?: string): string {
  const title = '<h3>Changes</h3>';
  if (p.note) return `${title}<p class="more">${esc(p.note)}</p>`;
  const hunks = hunksOf(p.lines);
  const pager = hunks.length > 1 ? PAGER.replaceAll('{n}', String(hunks.length)) : '';
  let prev: Header | undefined;
  const body = hunks.map((rows) => {
    const cur = headerOf(rows);
    const gap = outside(prev, cur);
    prev = cur;
    return `<div class="hunk folded">${gap}${head(rows)}<code class="hunk-body">${bodyHtml(rows)}</code></div>`;
  });
  const file = samePath(p, nodePath) ? '' : `<div class="file-head"><span class="path">${pathHtml(p.path)}</span></div>`;
  const cut = p.rows > p.lines.length ? `<p class="more">showing ${p.lines.length} of ${p.rows} lines</p>` : '';
  return `<h3 class="ch-head">Changes${totals(p)}</h3>${pager}<div class="file">${file}<div class="snippet diff">${body.join('')}</div></div>${cut}`;
}
