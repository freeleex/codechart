import { codeRow, pathHtml } from '../flow/html.js';
import type { Preview } from '../preview.js';
import { esc } from './page.js';

/** What Light shows of a diff: its first hunks and rows. Full shows the rest too (class `fo`: Full only, `lo`: Light only). */
const LIGHT_HUNKS = 3;
const LIGHT_ROWS = 40;
/** A node this small starts with every hunk open in Full. */
const SMALL_LINES = 80;
const SMALL_HUNKS = 6;

type Line = Preview['lines'][number];

const MARK = { add: '+', del: '-', ctx: ' ' } as const;
const HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;

function hunksOf(lines: Line[]): Line[][] {
  const out: Line[][] = [];
  for (const l of lines) {
    if (l.kind === 'hunk') out.push([l]);
    else out.at(-1)?.push(l);
  }
  return out;
}

const PAGER =
  '<div class="pager fo" role="group" aria-label="Hunks">' +
  '<button type="button" class="pg-prev" aria-label="Previous hunk" title="Previous hunk (p)">\u2039</button>' +
  '<span class="pg-count" aria-live="polite">{n} hunks</span>' +
  '<button type="button" class="pg-next" aria-label="Next hunk" title="Next hunk (n)">\u203a</button>' +
  '<button type="button" class="pg-keys" aria-label="Show keys" title="Keys">? keys</button></div>';

const count = (n: number) => `${n} changed line${n === 1 ? '' : 's'}`;

/** One line that says what a folded hunk holds: counts, where it starts, its function and its first change. */
function summary(rows: Line[], folded: boolean): string {
  const [head, ...body] = rows;
  const m = HEADER.exec(head!.text);
  const add = body.filter((l) => l.kind === 'add').length;
  const del = body.filter((l) => l.kind === 'del').length;
  const first = body.find((l) => l.kind !== 'ctx');
  return (
    `<button type="button" class="hunk-sum fo" aria-expanded="${!folded}"><span class="caret" aria-hidden="true"></span>` +
    `<span class="hs-stat"><span class="d-add">+${add}</span> <span class="d-del">\u2212${del}</span></span>` +
    (m ? `<span class="hs-ln">L${m[1]}</span>` : '') +
    (m?.[2] ? `<span class="hs-fn">${esc(m[2])}</span>` : '') +
    (first ? `<span class="hs-first">${esc(MARK[first.kind as 'add' | 'del'] + first.text.trim())}</span>` : '') +
    `</button>`
  );
}

/** The Changes section of a node panel: one set of hunks that Light cuts short and Full lets fold. */
export function changesHtml(p: Preview): string {
  const title = '<h3>Changes</h3>';
  if (p.note) return `${title}<p class="more">${esc(p.note)}</p>`;
  const hunks = hunksOf(p.lines);
  const pager = hunks.length > 1 ? PAGER.replace('{n}', String(hunks.length)) : '';
  const folded = p.total > SMALL_LINES || hunks.length > SMALL_HUNKS;
  let before = 0;
  let lightChanged = 0;
  const body = hunks.map((rows, i) => {
    const start = before;
    before += rows.length;
    const inLight = (j: number) => i < LIGHT_HUNKS && start + j < LIGHT_ROWS;
    const html = rows
      .map((l, j) => {
        const fo = inLight(j) ? '' : 'fo';
        if (l.kind === 'hunk') return codeRow(undefined, esc(l.text), 'd-hunk', `lo ${fo}`.trim());
        if (fo === '' && l.kind !== 'ctx') lightChanged++;
        return codeRow(l.n, esc(MARK[l.kind] + l.text), `d-${l.kind}`, fo);
      })
      .join('\n');
    return `<div class="hunk${folded ? ' folded' : ''}${inLight(0) ? '' : ' fo'}">${summary(rows, folded)}<code class="hunk-body">${html}</code></div>`;
  });
  const light =
    lightChanged < p.total
      ? `<button type="button" class="see-full" data-mode-set="full">showing ${lightChanged} of ${p.total} changed lines \u00b7 see all in Full</button>`
      : count(p.total);
  const full = p.rows > p.lines.length ? `showing ${p.lines.length} of ${p.rows} lines` : count(p.total);
  return (
    `${title}${pager}<div class="file"><div class="file-head fo"><span class="path">${pathHtml(p.path)}</span><span>${count(p.total)}</span></div>` +
    `<div class="snippet diff">${body.join('')}</div></div>` +
    `<p class="more"><span class="lo">${light}</span><span class="fo">${full}</span> \u00b7 whole file: <span class="path">${pathHtml(p.path)}</span></p>`
  );
}
