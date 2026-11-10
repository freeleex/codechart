// @vitest-environment happy-dom
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_MAX, blockOf } from '../../src/render/block.js';
import { checkMapNodes } from '../../src/render/check.js';
import { renderHtml } from '../../src/render/web/html.js';
import { layoutSpec } from '../../src/render/web/layout.js';
import { validateSpec, type Spec } from '../../src/spec/schema.js';
import { click, mount, node, q, qa, usePages } from '../helpers/page.js';

usePages();

const split = (text: string) => text.replace(/\n$/, '').split('\n');
const lineOf = (lines: string[], text: string) => lines.findIndex((l) => l.includes(text)) + 1;
/** The lines the block shows open. */
const open = (b: NonNullable<ReturnType<typeof blockOf>>) => b.lines.slice(b.from, b.to);

const PY = `import os
from alembic import op


def upgrade():
    op.create_table("orders")
    op.add_column("orders", "total")

    op.create_index("ix_orders")


def downgrade():
    op.drop_table("orders")
`;

const TS = `import { db } from './db';

export function createInvoice(order: Order) {
  const label = "closes } early";
  if (order.total === 0) {
    return null; // no { charge
  }
  return db.insert({ order, label });
}

export function other() {}
`;

const YAML = `name: ci
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test

  lint:
    runs-on: ubuntu-latest
`;

describe('blockOf', () => {
  it('Python: the def and the lines indented under it, blank lines inside kept, trailing ones not', () => {
    const lines = split(PY);
    const b = blockOf('m.py', lines, lineOf(lines, 'def upgrade'))!;
    expect(open(b)).toEqual(lines.slice(4, 9));
    expect(b.lines[b.hit!]).toBe('def upgrade():');
  });

  it('TypeScript: to the brace that closes the one the line opens, ignoring braces in strings and comments', () => {
    const lines = split(TS);
    const b = blockOf('a.ts', lines, lineOf(lines, 'export function createInvoice'))!;
    expect(open(b)).toEqual(lines.slice(2, 9));
    expect(open(b).at(-1)).toBe('}');
  });

  it('YAML: a key and everything nested under it', () => {
    const lines = split(YAML);
    const b = blockOf('ci.yml', lines, lineOf(lines, 'test:'))!;
    expect(open(b)).toEqual(lines.slice(2, 6));
  });

  it('a Python def whose parameters span lines still takes its body', () => {
    const lines = split('def f(\n    a,\n    b,\n):\n    return a\n\nx = 1\n');
    expect(open(blockOf('f.py', lines, 1)!)).toEqual(lines.slice(0, 5));
  });

  it('a line that opens nothing and has nothing nested shows a small window around it', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `x${i} = ${i}`);
    const b = blockOf('x.py', lines, 15)!;
    expect(open(b)).toEqual(lines.slice(11, 25));
    expect(b.lines[b.hit!]).toBe('x14 = 14');
  });

  it(`a longer block stops at ${BLOCK_MAX} lines and the rest waits behind a fold`, () => {
    const lines = ['def big():', ...Array.from({ length: 99 }, (_, i) => `    step(${i})`), 'after = 1'];
    const b = blockOf('big.py', lines, 1)!;
    expect(open(b)).toEqual(lines.slice(0, BLOCK_MAX));
    expect(b.lines.slice(b.to, b.to + 2)).toEqual(['    step(39)', '    step(40)']);
  });

  it('without a quoted line it is the top of the file', () => {
    const lines = Array.from({ length: 90 }, (_, i) => `line ${i + 1}`);
    const b = blockOf('x.txt', lines)!;
    expect(b.hit).toBeUndefined();
    expect(open(b)).toEqual(lines.slice(0, BLOCK_MAX));
  });

  it('keeps only 100 lines of context each side and counts the rest', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`);
    const b = blockOf('x.txt', lines, 250)!;
    // no brace or indent: shown 246..259, so 146 lines above the kept context and 140 below
    expect([b.above, b.below]).toEqual([146, 140]);
  });

  it('nothing for an empty file, a secret file or a private key', () => {
    expect(blockOf('a.ts', [])).toBeUndefined();
    expect(blockOf('.env', ['TOKEN=abc'])).toBeUndefined();
    expect(blockOf('notes.txt', ['-----BEGIN RSA PRIVATE KEY-----', 'abc'])).toBeUndefined();
  });
});

describe('explain panel', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'codechart-block-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const file = (rel: string, text: string) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  const raw = (kind: string, status: string, nodes: object[]) => ({
    title: 't',
    kind,
    nodes: nodes.map((n, i) => ({ id: `n${i}`, label: `box${i}`, kind: 'file', status, layer: 'l', ...n })),
    edges: [],
  });
  const draw = async (input: object) => {
    const r = validateSpec(input);
    if (!r.ok || r.spec.diagram === 'flow') throw new Error('fixture');
    const spec: Spec = r.spec;
    return renderHtml(spec, await layoutSpec(spec), { generatedAt: new Date('2026-11-10T12:00:00Z'), repo: 'demo' }, checkMapNodes(spec, dir));
  };
  const rowTexts = (sel: string) => qa(sel).map((r) => r.textContent);

  it('shows the block around the quoted line, highlighted, instead of the one line', async () => {
    file('m.py', PY);
    mount(await draw(raw('explain', 'existing', [{ path: 'm.py', match: 'def upgrade():' }])));
    click(node('n0'));
    expect(q('#panel .path').textContent).toBe('m.py:5');
    expect(rowTexts('#panel .snippet.block code > .ln')).toEqual(['5', '6', '7', '8', '9']);
    expect(q('#panel .snippet.block .hit').textContent).toBe('def upgrade():');
    expect(q('#panel .snippet.block').textContent).toContain('op.add_column("orders", "total")');
  });

  it('folds the lines before and after; a click opens them in place', async () => {
    file('m.py', PY);
    mount(await draw(raw('explain', 'existing', [{ path: 'm.py', match: 'def upgrade():' }])));
    click(node('n0'));
    expect(rowTexts('#panel .gap-run')).toEqual(['⋯ 4 lines above', '⋯ 4 more lines']);
    const above = q('#panel .cgap');
    expect(above.classList.contains('open')).toBe(false);
    click(q('#panel .gap-run'));
    expect(above.classList.contains('open')).toBe(true);
    expect(above.querySelector('.gap-rows')!.textContent).toContain('from alembic import op');
  });

  it('a block over the cap shows its first lines and folds the rest as "show more"', async () => {
    file('big.py', ['def big():', ...Array.from({ length: 99 }, (_, i) => `    step(${i})`), ''].join('\n'));
    mount(await draw(raw('explain', 'existing', [{ path: 'big.py', match: 'def big():' }])));
    click(node('n0'));
    expect(qa('#panel .snippet.block code > .ln')).toHaveLength(BLOCK_MAX);
    expect(rowTexts('#panel .gap-run')).toEqual([`⋯ ${100 - BLOCK_MAX} more lines`]);
  });

  it('a box with a path and no quoted line shows the top of its file, folded the same way', async () => {
    file('app/long.ts', Array.from({ length: 90 }, (_, i) => `const v${i} = ${i};`).join('\n'));
    mount(await draw(raw('explain', 'existing', [{ path: 'app/long.ts' }])));
    click(node('n0'));
    expect(q('#panel .path').textContent).toBe('app/long.ts');
    expect(qa('#panel .snippet.block code > .ln')).toHaveLength(BLOCK_MAX);
    expect(q('#panel .hit')).toBeNull();
    expect(rowTexts('#panel .gap-run')).toEqual([`⋯ ${90 - BLOCK_MAX} more lines`]);
  });

  it('an outside box with a path gets its file too; one without a path is unchanged', async () => {
    file('lib/mail.ts', 'export class Mail {\n  send() {}\n}\n');
    mount(await draw(raw('explain', 'outside', [{ path: 'lib/mail.ts', match: 'class Mail' }, { kind: 'other', label: 'Stripe' }])));
    click(node('n0'));
    expect(rowTexts('#panel .snippet.block code > .ln')).toEqual(['1', '2', '3']);
    click(node('n1'));
    expect(q('#panel .snippet.block')).toBeNull();
    expect(q('#panel .path')).toBeNull();
  });

  it('escapes the code', async () => {
    file('x.html', '<div class="a">\n  <script>alert(1)</script>\n</div>\n');
    mount(await draw(raw('explain', 'existing', [{ path: 'x.html', match: '<div class="a">' }])));
    click(node('n0'));
    expect(q('#panel .snippet.block script')).toBeNull();
    expect(q('#panel .snippet.block').textContent).toContain('<script>alert(1)</script>');
  });

  it('a change map keeps its one quoted line', async () => {
    file('m.py', PY);
    const html = await draw(raw('summary', 'changed', [{ path: 'm.py', match: 'def upgrade():' }]));
    mount(html);
    click(node('n0'));
    expect(q('#panel .snippet.block')).toBeNull();
    expect(q('#panel pre.snippet').textContent).toContain('def upgrade():');
    expect(q('#panel pre.snippet').textContent).not.toContain('add_column');
  });
});
