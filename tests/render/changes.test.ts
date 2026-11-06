// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseDiff, type Preview } from '../../src/render/preview.js';
import { changesHtml } from '../../src/render/web/changes.js';
import { CSS } from '../../src/render/web/styles.js';
import { click, flowPage, mount, node, panesPage, q, qa, shopPage, shopWith, usePages } from '../helpers/page.js';

usePages();

const hunk = (i: number, changed = 2) =>
  `@@ -${i * 20},3 +${i * 20},3 @@ fn${i}\n ctx\n${Array.from({ length: changed }, (_, j) => `-old${i}_${j}\n+new${i}_${j}`).join('\n')}\n`;
const diff = (hunks: number, changed = 1) => parseDiff('src/a.ts', Array.from({ length: hunks }, (_, i) => hunk(i + 1, changed)).join(''));

describe('changesHtml', () => {
  it('every hunk starts folded, whatever the size of the node', () => {
    for (const html of [changesHtml(diff(1)), changesHtml(diff(2)), changesHtml(diff(7)), changesHtml(diff(1, 41))]) {
      expect(html).not.toMatch(/class="hunk"/);
      expect(html.match(/class="hunk folded"/g)?.length).toBe(html.match(/class="hunk /g)?.length);
      expect(html).not.toContain('aria-expanded="true"');
    }
    expect(changesHtml(diff(3)).match(/aria-expanded="false"/g)).toHaveLength(3);
  });

  it('has no Light / Full leftovers: every hunk, row and control is always there', () => {
    const html = changesHtml(diff(5));
    expect(html.match(/class="hunk folded"/g)).toHaveLength(5);
    expect(html).not.toMatch(/\b(fo|lo)\b|see-full|data-mode|hunk-head/);
    expect(CSS).not.toMatch(/data-mode|\.fo\b|\.lo\b|mode-toggle|see-full/);
    expect(changesHtml(parseDiff('a', `@@ -0,0 +1,100 @@\n${Array.from({ length: 100 }, (_, i) => `+l${i}`).join('\n')}`)).match(/class="d-add dr"/g)).toHaveLength(100);
  });

  it('leading indentation stays as text in a pre span and sets a hanging indent, tabs count 4', () => {
    const html = changesHtml(parseDiff('a', '@@ -0,0 +1,3 @@\n+    deep\n+\ttab\n+flush'));
    expect(html).toContain('<span class="cd" style="padding-left:4ch;text-indent:-4ch"><span class="ind">    </span>deep</span>');
    expect(html).toContain('<span class="cd" style="padding-left:4ch;text-indent:-4ch"><span class="ind">\t</span>tab</span>');
    expect(html).toContain('<span class="cd">flush</span>');
    const el = document.createElement('div');
    el.innerHTML = html;
    expect([...el.querySelectorAll('.cd')].map((c) => c.textContent)).toEqual(['    deep', '\ttab', 'flush']);
    expect(CSS).toContain('aside .ind{white-space:pre;tab-size:4}');
  });

  it('a diff row is one tinted flex row: number, sign and code columns, frameless', () => {
    const html = changesHtml(parseDiff('a', '@@ -1,2 +1,2 @@\n-gone\n+here\n'));
    expect(html).toContain('<span class="d-del dr"><span class="ln">1</span><span class="sg">-</span><span class="cd">gone</span></span>');
    expect(html).toContain('<span class="d-add dr"><span class="ln">1</span><span class="sg">+</span><span class="cd">here</span></span>');
    expect(CSS).toContain('aside .dr .ln{flex:none;width:4.5ch;');
    expect(CSS).toContain('aside .dr .sg{flex:none;width:2.4ch;');
    expect(CSS).toContain('aside .dr.d-add{background:var(--add-bg)}');
    expect(CSS).toContain('aside .dr.d-del{background:var(--rem-bg)}');
    expect(CSS).toContain('--add-bg:rgba(46,160,67,.22);--rem-bg:rgba(248,81,73,.22)');
    expect(CSS).toContain('aside .snippet.diff{background:none;border:0;');
  });

  it('a hunk header is one button row: line, function, first change, counts on the right, on its own tinted band', () => {
    const html = changesHtml(diff(7));
    expect(html).toContain('<button type="button" class="hunk-sum hh" aria-expanded="false"><span class="caret" aria-hidden="true"></span><span class="hs-ln">L20</span><span class="hs-fn">fn1</span><span class="hs-first">-old1_0</span><span class="hs-stat"><span class="n-add">+1</span> <span class="n-del">−1</span></span></button>');
    expect(CSS).toContain('--hh-bg:rgba(56,139,253,.10)');
    expect(CSS).toContain('--hh-bg:rgba(9,105,218,.07)');
    expect(CSS).toMatch(/aside \.hh\{[^}]*background:var\(--hh-bg\)/);
    expect(CSS).toContain('aside .hunk+.hunk{margin-top:4px}');
    expect(CSS).not.toMatch(/\.hh\{[^}]*var\(--gap-bg\)/);
  });

  it('the Changes heading names the file and carries +N −M; no file row or footer', () => {
    const html = changesHtml(diff(2, 2));
    expect(html.startsWith('<h3 class="ch-head">Changes<span class="ch-path">src/<wbr>a.ts</span><span class="fh-stat"><span class="n-add">+4</span> <span class="n-del">−4</span></span></h3>')).toBe(true);
    expect(html).not.toContain('file-head');
    expect(html).not.toContain('whole file');
    expect(html).not.toContain('changed lines');
    expect(CSS).not.toContain('file-head');
  });

  it('names the file in the heading of a note-only section too', () => {
    const html = changesHtml({ path: 'src/a.ts', lines: [], total: 0, rows: 0, note: 'binary file' });
    expect(html).toContain('<h3 class="ch-head">Changes<span class="ch-path">src/<wbr>a.ts</span></h3><p class="more">binary file</p>');
  });

  it('a capped file says so under the hunks and gives its total in the heading', () => {
    const big: Preview = { ...diff(1), rows: 5000, total: 9 };
    const html = changesHtml(big);
    expect(html).toContain('Changes<span class="ch-path">src/<wbr>a.ts</span><span class="fh-stat">9 changed lines</span></h3>');
    expect(html).toContain(`<p class="more">showing ${big.lines.length} of 5000 lines</p>`);
    expect(changesHtml({ path: 'package-lock.json', lines: [], total: 0, rows: 0, note: 'generated file, not shown' })).toBe(
      '<h3 class="ch-head">Changes<span class="ch-path">package-lock.json</span></h3><p class="more">generated file, not shown</p>',
    );
  });

  it('a pager of real labelled buttons comes with 2 or more hunks', () => {
    const html = changesHtml(diff(2));
    expect(html).toContain('<div class="pager" role="group" aria-label="Hunks">');
    expect(html).toContain('aria-label="Previous hunk"');
    expect(html).toContain('<span class="pg-count" role="status" aria-label="2 hunks">– / 2</span>');
    expect(html).toContain('aria-label="Next hunk"');
    expect(html).toContain('? keys</button>');
    expect(changesHtml(diff(1))).not.toContain('pager');
    expect(changesHtml({ ...diff(1), lines: [], note: 'binary file' })).not.toContain('pager');
  });

  it('escapes the code and the function context', () => {
    const html = changesHtml(parseDiff('a', '@@ -1 +1 @@ <b>f</b>\n+<i>x</i>\n'));
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<i>');
  });
});

const ctxHunk = (head: string, ...kinds: string[]) => parseDiff('a.ts', `${head}\n${kinds.join('\n')}\n`);
const gapRuns = (html: string) => [...html.matchAll(/class="gap gap-run" aria-expanded="false">⋯ ([^<]+)</g)].map((m) => m[1]);
const gapsOut = (html: string) => [...html.matchAll(/class="gap gap-out">⋯ ([^<]+)</g)].map((m) => m[1]);

describe('gap rows', () => {
  it('4 or more unchanged lines in a hunk collapse into one button; fewer stay visible', () => {
    const html = changesHtml(ctxHunk('@@ -1,9 +1,9 @@', '+a', ' c1', ' c2', ' c3', ' c4', '+b', ' d1', ' d2', ' d3', '+c'));
    expect(gapRuns(html)).toEqual(['4 unchanged lines']);
    expect(html.match(/<span class="gap-rows">/g)).toHaveLength(1);
    expect(html).toContain('<span class="cgap"><button type="button" class="gap gap-run" aria-expanded="false">⋯ 4 unchanged lines</button><span class="gap-rows"><span class="d-ctx dr"><span class="ln">2</span>');
    const el = document.createElement('div');
    el.innerHTML = html;
    expect(el.querySelector('.gap-rows')!.textContent).toContain('c4');
    expect(el.querySelectorAll('.cgap')).toHaveLength(1);
    expect([...el.querySelectorAll('.hunk-body > .dr')].map((r) => r.querySelector('.cd')!.textContent)).toEqual(['a', 'b', 'd1', 'd2', 'd3', 'c']);
  });

  it('a run of exactly 3 stays, one of 5 collapses and says so', () => {
    expect(gapRuns(changesHtml(ctxHunk('@@ -1,5 +1,5 @@', ' a', ' b', ' c', '+x')))).toEqual([]);
    expect(gapRuns(changesHtml(ctxHunk('@@ -1,5 +1,5 @@', '+x', ' a', ' b', ' c', ' d', ' e')))).toEqual(['5 unchanged lines']);
  });

  it('between hunks of a file: lines not in the diff; before the first: lines above; none when 0', () => {
    const html = changesHtml(parseDiff('a.ts', '@@ -10,3 +10,3 @@\n a\n-b\n+c\n@@ -30,2 +30,2 @@\n-d\n+e\n@@ -32,1 +32,1 @@\n-f\n+g\n'));
    expect(gapsOut(html)).toEqual(['9 lines above', '17 lines not in the diff']);
    expect(changesHtml(diff(1))).toContain('>⋯ 19 lines above<');
    expect(gapsOut(changesHtml(parseDiff('a', '@@ -1,2 +1,2 @@\n-a\n+b\n')))).toEqual([]);
  });

  it('counts one line in the singular and a pure deletion covers no new line', () => {
    expect(gapsOut(changesHtml(parseDiff('a', '@@ -2,1 +2,1 @@\n-a\n+b\n')))).toEqual(['1 line above']);
    const del = parseDiff('a', '@@ -3,2 +3,0 @@\n-a\n-b\n@@ -9,1 +8,1 @@\n-c\n+d\n');
    expect(gapsOut(changesHtml(del))).toEqual(['3 lines above', '4 lines not in the diff']);
  });

  it('outer gaps are not buttons and a folded hunk hides its gap', () => {
    const html = changesHtml(diff(7));
    expect(html).not.toMatch(/<button[^>]*gap-out/);
    expect(CSS).toContain('aside .hunk.folded .hunk-body,aside .hunk.folded .gap-out{display:none}');
  });
});

const withDiffs = (changed = 1, hunks = 8) =>
  shopWith(new Map([['tbl.orders', diff(hunks, changed)], ['tbl.invoices', diff(2)]]));
const key = (k: string, init: KeyboardEventInit = {}, target: EventTarget = window) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
const hunks = () => qa<HTMLElement>('#panel .hunk');
const current = () => qa('#panel .hunk.cur').map((h) => hunks().indexOf(h as HTMLElement));
const folded = () => hunks().map((h) => h.classList.contains('folded'));
const selected = () => q('.node.selected')?.getAttribute('data-id');

describe('page chrome of a diff page', () => {
  it('has no mode switch or attribute; ticks, progress row and Reviewed box are always there', () => {
    for (const page of [withDiffs(), shopPage, panesPage, flowPage]) {
      mount(page);
      expect(document.documentElement.hasAttribute('data-mode')).toBe(false);
      expect(document.getElementById('mode-toggle')).toBeNull();
      expect(qa('.fo, .lo')).toHaveLength(0);
      expect(qa('.tick').length).toBeGreaterThan(0);
      expect(q('#review')).not.toBeNull();
    }
  });

  it('the status and review bar sits under the header, before main, as on main', () => {
    mount(withDiffs());
    const bar = q('#toolbar');
    expect(bar.previousElementSibling?.tagName).toBe('HEADER');
    expect(bar.nextElementSibling?.tagName).toBe('MAIN');
    expect(CSS).toMatch(/#toolbar\{[^}]*border-bottom:1px solid var\(--line\)/);
  });

  it('the Reviewed tickbox sits left of the title on one line, named Reviewed, same state as the node tick', () => {
    mount(withDiffs());
    click(node('tbl.orders'));
    const title = q('#panel h2.ptitle');
    const box = title.querySelector<HTMLInputElement>('input[data-tick-for="tbl.orders"]')!;
    expect(box.getAttribute('aria-label')).toBe('Reviewed');
    expect(title.firstElementChild).toBe(box);
    expect(title.textContent).toContain('orders');
    expect(qa('#panel .tick-row, #panel label')).toHaveLength(0);
    click(box);
    expect(node('tbl.orders').classList.contains('reviewed')).toBe(true);
  });

  it('a panel with changes names the file once, in the Changes heading, with no separate path line', () => {
    mount(shopWith(new Map([['tbl.orders', parseDiff('shop/models/order.py', '@@ -1 +1 @@\n-a\n+b\n')]])));
    click(node('tbl.orders'));
    expect(qa('#panel .file-head')).toHaveLength(0);
    expect(q('#panel').textContent).not.toContain('whole file');
    expect(q('#panel').textContent?.match(/shop\/models\/order\.py/g)).toHaveLength(1);
    expect(q('#panel .ch-head .ch-path').textContent).toBe('shop/models/order.py');
    expect(qa('#panel > .path')).toHaveLength(0);
    click(node('tbl.customers'));
    expect(qa('#panel > .path')).toHaveLength(1);
  });
});

describe('hunk keys', () => {
  const full = () => {
    mount(withDiffs());
    click(node('tbl.orders'));
  };

  it('n and p walk the hunks, opening and highlighting each; the end says what is next', () => {
    full();
    expect(folded().every(Boolean)).toBe(true);
    key('n');
    expect(current()).toEqual([0]);
    expect(folded()[0]).toBe(false);
    key('n');
    key('n');
    expect(current()).toEqual([2]);
    key('p');
    expect(current()).toEqual([1]);
    key('p');
    key('p');
    expect(current()).toEqual([0]);
    for (let i = 0; i < 8; i++) key('n');
    expect(current()).toEqual([7]);
    expect(q('#panel .hunk-end').textContent).toBe('end of node · ] next unreviewed');
    key('n');
    expect(qa('#panel .hunk-end')).toHaveLength(1);
    key('p');
    expect(qa('#panel .hunk-end')).toHaveLength(0);
    expect(current()).toEqual([7]);
  });

  it('stepping never scrolls the panel', () => {
    full();
    const aside = q<HTMLElement>('#aside-scroll');
    aside.scrollTop = 123;
    for (const k of ['n', 'n', 'p']) key(k);
    for (let i = 0; i < 9; i++) key('n');
    expect(aside.scrollTop).toBe(123);
  });

  it('stepping is an accordion: the target opens, every other hunk folds; clicking a summary only toggles that hunk', () => {
    full();
    key('O');
    expect(folded().every((f) => !f)).toBe(true);
    key('n');
    expect(folded()).toEqual([false, true, true, true, true, true, true, true]);
    key('n');
    expect(folded()).toEqual([true, false, true, true, true, true, true, true]);
    key('p');
    expect(folded()).toEqual([false, true, true, true, true, true, true, true]);
    click(q('#panel .hunk:nth-of-type(4) .hunk-sum'));
    click(q('#panel .hunk:nth-of-type(5) .hunk-sum'));
    expect(folded()).toEqual([false, true, true, false, false, true, true, true]);
  });

  it('o folds the current hunk, O all or opens all', () => {
    full();
    key('n');
    key('o');
    expect(folded()[0]).toBe(true);
    key('o');
    expect(folded()[0]).toBe(false);
    key('O');
    expect(folded().every((f) => !f)).toBe(true);
    key('O');
    expect(folded().every(Boolean)).toBe(true);
  });

  it('clicking a hunk line folds it and makes it current', () => {
    full();
    click(q('#panel .hunk:nth-of-type(3) .hunk-sum'));
    expect(folded()[2]).toBe(false);
    expect(current()).toEqual([2]);
    key('n');
    expect(current()).toEqual([3]);
  });

  it('r toggles Reviewed like the box and the tick, with no advance', () => {
    full();
    key('r');
    expect(qa('.node.reviewed').map((g) => g.getAttribute('data-id'))).toEqual(['tbl.orders']);
    expect(q<HTMLInputElement>('#panel input[data-tick-for="tbl.orders"]').checked).toBe(true);
    expect(q('#review-count').textContent).toBe('1/12 reviewed');
    expect(selected()).toBe('tbl.orders');
    key('r');
    expect(qa('.node.reviewed')).toHaveLength(0);
  });

  it('] and [ select the next and previous unreviewed node and restart at hunk 1', () => {
    full();
    key('n');
    key('n');
    key(']');
    expect(selected()).not.toBe('tbl.orders');
    const there = selected();
    expect(current()).toEqual([]);
    key('[');
    expect(selected()).toBe('tbl.orders');
    expect(there).toBeDefined();
    click(q('#next-unreviewed'));
    expect(selected()).toBe(there);
  });

  it('? toggles the key help; Esc closes it', () => {
    full();
    const help = q<HTMLElement>('#key-help');
    expect(help.hidden).toBe(true);
    key('?', { shiftKey: true });
    expect(help.hidden).toBe(false);
    key('Escape');
    expect(help.hidden).toBe(true);
  });

  it('ignores keys with Ctrl, Meta or Alt held and while typing in a field; a focused checkbox still works', () => {
    full();
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) key('n', { [mod]: true });
    expect(current()).toEqual([]);
    const field = document.createElement('input');
    field.type = 'text';
    document.body.appendChild(field);
    key('n', {}, field);
    expect(current()).toEqual([]);
    const box = q<HTMLInputElement>('#panel input[data-tick-for]');
    key('n', {}, box);
    expect(current()).toEqual([0]);
  });

  it('on a node without hunks n shows the end note', () => {
    full();
    click(node('tbl.customers'));
    key('n');
    expect(qa('#panel .hunk-end')).toHaveLength(1);
  });

  it('the review, node and help keys work on a Now / After plan, ', () => {
    mount(panesPage);
    click(node('users'));
    key('r');
    expect(qa('.node.reviewed').map((g) => g.getAttribute('data-id'))).toEqual(['users', 'users']);
    key(']');
    expect(selected()).not.toBe('users');
    key('?', { shiftKey: true });
    expect(q<HTMLElement>('#key-help').hidden).toBe(false);
  });
});

describe('hunk pager', () => {
  const count = () => q('#panel .pg-count').textContent;
  const open = () => {
    mount(withDiffs());
    click(node('tbl.orders'));
  };

  it('shows the hunk count, none current; a node with 2 hunks has it, a node with 0 or 1 does not', () => {
    open();
    expect(count()).toBe('– / 8');
    click(node('tbl.invoices'));
    expect(count()).toBe('– / 2');
    click(node('tbl.customers'));
    expect(qa('#panel .pager')).toHaveLength(0);
  });

  it('the buttons do what n and p do, and the count follows, with a spoken label', () => {
    open();
    click(q('#panel .pg-next'));
    click(q('#panel .pg-next'));
    expect(count()).toBe('2 / 8');
    expect(q('#panel .pg-count').getAttribute('aria-label')).toBe('hunk 2 of 8');
    expect(current()).toEqual([1]);
    expect(folded()[1]).toBe(false);
    click(q('#panel .pg-prev'));
    expect(count()).toBe('1 / 8');
    key('n');
    expect(count()).toBe('2 / 8');
    key('p');
    expect(count()).toBe('1 / 8');
  });

  it('› past the last hunk shows the end note and keeps the count', () => {
    open();
    for (let i = 0; i < 9; i++) click(q('#panel .pg-next'));
    expect(count()).toBe('8 / 8');
    expect(qa('#panel .hunk-end')).toHaveLength(1);
    click(q('#panel .pg-prev'));
    expect(qa('#panel .hunk-end')).toHaveLength(0);
  });

  it('clicking a hunk line updates the count; a new panel resets it', () => {
    open();
    click(q('#panel .hunk:nth-of-type(3) .hunk-sum'));
    expect(count()).toBe('3 / 8');
    click(node('tbl.invoices'));
    expect(count()).toBe('– / 2');
    click(node('tbl.orders'));
    expect(count()).toBe('– / 8');
    expect(current()).toEqual([]);
  });

  it('Expand all and Collapse all open or fold every hunk, no toggling, and only a node with 2+ hunks has them', () => {
    open();
    expect(q('#panel .pg-expand').getAttribute('aria-label')).toBe('Expand all');
    expect(q('#panel .pg-collapse').getAttribute('aria-label')).toBe('Collapse all');
    click(q('#panel .pg-expand'));
    click(q('#panel .pg-expand'));
    expect(folded().every((f) => !f)).toBe(true);
    click(q('#panel .pg-collapse'));
    click(q('#panel .pg-collapse'));
    expect(folded().every(Boolean)).toBe(true);
    click(node('tbl.customers'));
    expect(qa('#panel .pg-expand, #panel .pg-collapse')).toHaveLength(0);
  });

  it('? keys toggles the key help', () => {
    open();
    click(q('#panel .pg-keys'));
    expect(q<HTMLElement>('#key-help').hidden).toBe(false);
    click(q('#panel .pg-keys'));
    expect(q<HTMLElement>('#key-help').hidden).toBe(true);
  });

  it('Space and Enter on a pager button start no key action', () => {
    open();
    const next = q('#panel .pg-next');
    for (const k of [' ', 'Enter']) key(k, {}, next);
    expect(current()).toEqual([]);
    expect(q<HTMLElement>('#key-help').hidden).toBe(true);
    expect(qa('.node.reviewed')).toHaveLength(0);
    key('n', {}, next);
    expect(current()).toEqual([0]);
  });
});

describe('unchanged-line gaps in the panel', () => {
  const gapDiff = parseDiff('src/a.ts', '@@ -1,8 +1,8 @@ fn\n-a\n+b\n c1\n c2\n c3\n c4\n c5\n-d\n+e\n');
  const open = () => {
    mount(shopWith(new Map([['tbl.orders', gapDiff]])));
    click(node('tbl.orders'));
  };

  it('clicking the button opens the run in place and flips aria-expanded; again closes it', () => {
    open();
    const btn = q('#panel .gap-run');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    click(btn);
    expect(q('#panel .cgap').classList.contains('open')).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    click(btn);
    expect(q('#panel .cgap').classList.contains('open')).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('+ all / − all and o/O fold hunks only; an opened gap stays as left', () => {
    mount(shopWith(new Map([['tbl.orders', parseDiff('src/a.ts', `${gapDiff.lines.map((l) => (l.kind === 'hunk' ? l.text : `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`)).join('\n')}\n@@ -40,2 +40,2 @@\n-x\n+y\n`)]])));
    click(node('tbl.orders'));
    click(q('#panel .gap-run'));
    click(q('#panel .pg-collapse'));
    expect(folded().every(Boolean)).toBe(true);
    expect(q('#panel .cgap').classList.contains('open')).toBe(true);
    click(q('#panel .pg-expand'));
    expect(q('#panel .gap-run').getAttribute('aria-expanded')).toBe('true');
  });
});
