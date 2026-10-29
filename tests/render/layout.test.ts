import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { layoutSpec, wrapSummary, SUMMARY_CHARS_PER_LINE, SUMMARY_MAX_LINES } from '../../src/render/web/layout.js';
import { validateSpec, type Spec } from '../../src/spec/schema.js';

function loadFixture(): Spec {
  const raw = JSON.parse(readFileSync('tests/fixtures/shop.spec.json', 'utf8'));
  const result = validateSpec(raw);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  if (result.spec.diagram === 'flow') throw new Error('expected map spec');
  return result.spec;
}

function tinySpec(): Spec {
  return {
    title: 't',
    kind: 'plan',
    nodes: [
      { id: 'a', label: 'a', kind: 'table', status: 'new', layer: 'db' },
      {
        id: 'b',
        label: 'b',
        kind: 'table',
        status: 'new',
        layer: 'db',
        fields: Array.from({ length: 6 }, (_, i) => ({ name: `f${i}` })),
      },
    ],
    edges: [],
  };
}

const TOL = 2;
const near = (v: number, lo: number, hi: number) => v >= lo - TOL && v <= hi + TOL;

describe('layoutSpec', () => {
  it('every spec node has a position inside its layer group', async () => {
    const spec = loadFixture();
    const layout = await layoutSpec(spec);
    expect(layout.nodes).toHaveLength(spec.nodes.length);
    for (const sn of spec.nodes) {
      const n = layout.nodes.find((x) => x.id === sn.id)!;
      const g = layout.groups.find((x) => x.layer === sn.layer)!;
      expect(g).toBeDefined();
      expect(n.x).toBeGreaterThanOrEqual(g.x);
      expect(n.y).toBeGreaterThanOrEqual(g.y);
      expect(n.x + n.w).toBeLessThanOrEqual(g.x + g.w);
      expect(n.y + n.h).toBeLessThanOrEqual(g.y + g.h);
    }
  });

  it('every edge has >= 2 points', async () => {
    const layout = await layoutSpec(loadFixture());
    expect(layout.edges).toHaveLength(11);
    for (const e of layout.edges) expect(e.points.length).toBeGreaterThanOrEqual(2);
  });

  it('node height grows with field count', async () => {
    const layout = await layoutSpec(tinySpec());
    const a = layout.nodes.find((n) => n.id === 'a')!;
    const b = layout.nodes.find((n) => n.id === 'b')!;
    expect(b.h).toBeGreaterThan(a.h);
    expect(a.h).toBe(28);
    expect(b.h).toBe(28 + 16 * 6);
    expect(a.w).toBe(220);
  });

  it('cross-layer edges supported', async () => {
    await expect(layoutSpec(loadFixture())).resolves.toBeDefined();
  });

  it('edge endpoints lie on source/target borders in absolute coordinates', async () => {
    const layout = await layoutSpec(loadFixture());
    for (const e of layout.edges) {
      const s = layout.nodes.find((n) => n.id === e.from)!;
      const t = layout.nodes.find((n) => n.id === e.to)!;
      const first = e.points[0]!;
      const last = e.points[e.points.length - 1]!;
      const onBorder = (p: { x: number; y: number }, n: typeof s) =>
        (near(p.y, n.y, n.y + n.h) &&
          (Math.abs(p.x - n.x) <= TOL || Math.abs(p.x - (n.x + n.w)) <= TOL)) ||
        (near(p.x, n.x, n.x + n.w) &&
          (Math.abs(p.y - n.y) <= TOL || Math.abs(p.y - (n.y + n.h)) <= TOL));
      expect(onBorder(first, s), `${e.from}->${e.to} start`).toBe(true);
      expect(onBorder(last, t), `${e.from}->${e.to} end`).toBe(true);
    }
  });

  it('node height counts wrapped summary lines, capped', async () => {
    const mk = (summary: string): Spec => ({
      title: 't',
      kind: 'plan',
      nodes: [{ id: 'a', label: 'a', kind: 'table', status: 'new', layer: 'db', summary }],
      edges: [],
    });
    const h = async (s: string) => (await layoutSpec(mk(s))).nodes[0]!.h;
    expect(await h('short')).toBe(28 + 16);
    expect(await h('word '.repeat(10).trim())).toBe(28 + 16 * 2);
    expect(await h('word '.repeat(60).trim())).toBe(28 + 16 * SUMMARY_MAX_LINES);
  });
});

describe('wrapSummary', () => {
  it('wraps on word boundaries within the limit', () => {
    const lines = wrapSummary('One invoice per paid order, numbered from a prefix');
    expect(lines.length).toBeLessThanOrEqual(SUMMARY_MAX_LINES);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(SUMMARY_CHARS_PER_LINE);
    expect(lines.join(' ')).toBe('One invoice per paid order, numbered from a prefix');
  });
  it('ellipsizes on overflow', () => {
    const lines = wrapSummary('word '.repeat(60).trim());
    expect(lines).toHaveLength(SUMMARY_MAX_LINES);
    expect(lines[2]!.endsWith('…')).toBe(true);
    expect(lines[2]!.length).toBeLessThanOrEqual(SUMMARY_CHARS_PER_LINE);
  });
  it('hard-splits overlong words and handles empty', () => {
    expect(wrapSummary('x'.repeat(40))[0]!.length).toBeLessThanOrEqual(SUMMARY_CHARS_PER_LINE);
    expect(wrapSummary('')).toEqual([]);
  });
  it('line count matches ceil(len/34) capped for fixture summaries', () => {
    const lines = wrapSummary('a'.repeat(50));
    expect(lines.length).toBe(2);
  });
});
