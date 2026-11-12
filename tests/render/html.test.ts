import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { layoutSpec } from '../../src/render/web/layout.js';
import { CSS } from '../../src/render/web/styles.js';
import { renderHtml, type Theme } from '../../src/render/web/html.js';
import { gapBoxes, withGaps } from '../../src/render/web/gaps.js';
import { prettyDate } from '../../src/render/web/page.js';
import { validateSpec, type Spec } from '../../src/spec/schema.js';

function loadFixture(): Spec {
  const raw = JSON.parse(readFileSync('tests/fixtures/shop.spec.json', 'utf8'));
  const result = validateSpec(raw);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  if (result.spec.diagram === 'flow') throw new Error('expected map spec');
  return result.spec;
}
const meta = { generatedAt: new Date('2026-10-27T12:00:00Z'), repo: 'demo' };
async function html(spec: Spec): Promise<string> {
  return renderHtml(spec, await layoutSpec(spec), meta);
}

describe('renderHtml', () => {
  it('single file: no external script/link/url references', async () => {
    const out = await html(loadFixture());
    expect(out).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(out).not.toMatch(/<link[^>]*\shref=/i);
    expect(out).not.toMatch(/https?:\/\//i);
  });

  it('contains one <g data-id> per node, with a status class', async () => {
    const spec = loadFixture();
    const out = await html(spec);
    const matches = [...out.matchAll(/<g class="node status-(\w+)[^"]*" data-id="([^"]+)"/g)];
    expect(matches).toHaveLength(spec.nodes.length);
    for (const n of spec.nodes) {
      expect(matches.some((m) => m[2] === n.id && m[1] === n.status)).toBe(true);
    }
  });

  it('added fields have field-added, removed fields have field-removed', async () => {
    const spec = loadFixture();
    spec.nodes[0]!.fields = [
      { name: 'new_col', change: 'added' },
      { name: 'old_col', change: 'removed' },
    ];
    const out = await html(spec);
    expect(out).toMatch(/class="field field-added"[^>]*>[^<]*new_col/);
    expect(out).toMatch(/class="field field-removed"[^>]*>[^<]*old_col/);
  });

  it('modified fields on the card have field-modified', async () => {
    const spec = loadFixture();
    spec.nodes[0]!.fields = [{ name: 'role', change: 'modified' }];
    expect(await html(spec)).toMatch(/class="field field-modified"[^>]*>[^<]*role/);
  });

  it('html marks removed nodes', async () => {
    const spec = loadFixture();
    spec.nodes[0]!.status = 'removed';
    const out = await html(spec);
    expect(out).toMatch(new RegExp(`<g class="node status-removed shape-[a-z]+" data-id="${spec.nodes[0]!.id}"[^>]*>.*?<text class="badge"[^>]*>removed</text>`));
    expect(out).toContain('.status-removed :is(.card,.fold,.deco){stroke:var(--rem)}');
    expect(out).toContain('.status-removed .badge{fill:var(--rem)}');
    expect(out).toContain('.status-removed .label{text-decoration:line-through}');
  });

  it('escapes hostile summary: raw string absent', async () => {
    const evil = '</script><img src=x onerror=alert(1)>';
    const spec = loadFixture();
    spec.title = evil;
    spec.nodes[0]!.summary = evil;
    spec.nodes[0]!.label = evil;
    spec.nodes[0]!.notes = [evil];
    spec.gaps = [evil];
    const out = await html(spec);
    expect(out).not.toContain(evil);
    expect(out).not.toContain('<img src=x');
    expect(out.match(/<\/script>/g)!.length).toBe(2);
  });

  describe('card panel', () => {
    const cardPanel = (out: string, id: string): string => {
      const m = out.match(new RegExp(`<template class="card-panel" data-for="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">([\\s\\S]*?)</template>`));
      if (!m) throw new Error(`no card panel for ${id}`);
      return m[1]!;
    };
    const NOTE =
      'Only the fields the agent saw are listed. Set <code>defaults.context: full</code> in <code>.codechart.yaml</code> to let it read the full definition.';

    it('card panel lists unchanged and changed fields with markers', async () => {
      const spec = loadFixture();
      spec.nodes[0]!.fields = [
        { name: 'id', type: 'uuid', note: 'PK' },
        { name: 'coupon_code', type: 'uuid', change: 'added' },
        { name: 'legacy', change: 'removed' },
        { name: 'status', type: 'order_status', change: 'modified' },
      ];
      const panel = cardPanel(await html(spec), spec.nodes[0]!.id);
      expect(panel).toContain('<li>id: uuid (PK)</li>');
      expect(panel).toContain('<li class="field-added-t">+ coupon_code: uuid</li>');
      expect(panel).toContain('<li class="field-removed-t">- legacy</li>');
      expect(panel).toContain('<li class="field-modified-t">~ status: order_status</li>');
    });

    it('panel field styles: removed muted and struck, modified amber', async () => {
      const out = await html(loadFixture());
      expect(out).toMatch(/\.field-removed-t\{[^}]*color:var\(--muted\)[^}]*text-decoration:line-through/);
      expect(out).toMatch(/\.field-modified-t\{color:var\(--chg-t\)\}/);
    });

    it('fieldsComplete false → note shown', async () => {
      const spec = loadFixture();
      spec.nodes[0]!.fieldsComplete = false;
      spec.nodes[1]!.fieldsComplete = true;
      const out = await html(spec);
      expect(cardPanel(out, spec.nodes[0]!.id)).toContain(`<p class="fields-note">${NOTE}</p>`);
      expect(cardPanel(out, spec.nodes[1]!.id)).not.toContain('fields-note');
    });

    it('panel shows path, summary and notes, escaped', async () => {
      const spec = loadFixture();
      spec.nodes[0]!.notes = ['a <b> note'];
      const panel = cardPanel(await html(spec), spec.nodes[0]!.id);
      expect(panel).toContain('<div class="path">shop/<wbr>models/<wbr>order.py</div>');
      expect(panel).toContain('<li>a &lt;b&gt; note</li>');
    });
  });

  describe('page-level not on map / gaps', () => {
    it('omitted/gaps not inside the card panel, shown in the page-level section', async () => {
      const spec = loadFixture();
      spec.gaps = ['no tests for backfill'];
      spec.omitted = ['docs/ not drawn'];
      const out = await html(spec);
      const info = out.match(/<section id="page-info"[^>]*>([\s\S]*?)<\/section>/)![1]!;
      expect(info).toContain('<h3>Gaps</h3><ul data-notes="gap"><li>no tests for backfill</li></ul>');
      expect(info).toContain('<h3>Not on map</h3><ul data-notes="omitted"><li>docs/ not drawn</li></ul>');
      for (const m of out.matchAll(/<template class="card-panel"[^>]*>([\s\S]*?)<\/template>/g)) {
        expect(m[1]).not.toContain('no tests for backfill');
        expect(m[1]).not.toContain('docs/ not drawn');
      }
      expect(out).toContain('<button id="info-toggle" type="button"');
      expect(out).toContain('>Not on map / gaps</button>');
    });

    it('no gaps and no omitted → no header button', async () => {
      const spec = loadFixture();
      delete spec.gaps;
      spec.omitted = [];
      const out = await html(spec);
      expect(out).not.toContain('id="info-toggle"');
      expect(out).toContain('<section id="page-info"');
    });
  });

  describe('omitted groups on the canvas', () => {
    it('an entry that says why is a dashed box with its own panel', async () => {
      const spec = loadFixture();
      spec.omitted = ['frontend pages and components calling telemetry: frontend/src/pages/'];
      const gaps = gapBoxes(spec);
      const out = renderHtml(spec, await layoutSpec(withGaps(spec, gaps)), meta, undefined, undefined, undefined, gaps);
      expect(out).toContain('<g class="node gap" data-id="omitted-0"');
      expect(out).toContain('frontend pages and components calling telemetry');
      expect(out).toContain('<template class="card-panel" data-for="omitted-0"><div class="gap-panel">');
      expect(out).toContain('id="page-info"');
      expect(CSS).toContain('.node.gap .card{fill:var(--bg)');
    });

    it('a bare list gets no box and stays in the page info', async () => {
      const spec = loadFixture();
      spec.omitted = ['tests: shop/tests/*'];
      const gaps = gapBoxes(spec);
      expect(gaps).toEqual([]);
      const out = renderHtml(spec, await layoutSpec(withGaps(spec, gaps)), meta, undefined, undefined, undefined, gaps);
      expect(out).not.toContain('class="node gap"');
      expect(out).toContain('<li>tests: shop/tests/*</li>');
    });
  });

  it('has prefers-color-scheme dark rules', async () => {
    expect(await html(loadFixture())).toMatch(/@media \(prefers-color-scheme: dark\)/);
  });

  it('wraps long summaries into <= 3 tspans with ellipsis', async () => {
    const spec = loadFixture();
    spec.nodes[0]!.summary = 'word '.repeat(60).trim();
    const out = await html(spec);
    const g = out.split('data-id="' + spec.nodes[0]!.id + '"')[1]!.split('</g>')[0]!;
    expect(g.match(/class="summary"/g)).toHaveLength(3);
    expect(g).toContain('…');
  });

  it('a long label takes a second header line and the card grows to fit', async () => {
    const spec = loadFixture();
    const n = spec.nodes[0]!;
    const before = await html(spec);
    n.label = 'aws_s3_bucket_lifecycle_configuration.logs';
    const out = await html(spec);
    const card = (page: string) => page.split(`data-id="${n.id}"`)[1]!.split('</g>')[0]!;
    expect([...card(out).matchAll(/class="label"[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual(['aws_s3_bucket_', 'lifecycle_configuration.logs']);
    const height = (page: string) => Number(card(page).match(/class="card"[^>]*height="([\d.]+)"/)![1]);
    expect(height(out)).toBe(height(before) + 14);
  });

  const KINDS = ['endpoint', 'service', 'component', 'table', 'model', 'enum', 'config', 'file', 'other'] as const;
  async function nodeG(kind: string, status = 'changed', flagged = false): Promise<string> {
    const spec = loadFixture();
    spec.nodes[0] = { ...spec.nodes[0]!, kind, status } as Spec['nodes'][number];
    const id = spec.nodes[0].id;
    const check = flagged ? { checked: 1, unit: 'node', mismatches: [{ id, label: 'x', short: 'file missing', detail: 'x does not exist' }], matches: new Map(), blocks: new Map(), found: new Map() } : undefined;
    const out = renderHtml(spec, await layoutSpec(spec), meta, check as never);
    const start = `<g class="node status-${status} shape-${kind}" data-id="${id}"`;
    return start + out.split(start)[1]!.split(/<g class="(?!tick)/)[0];
  }
  const num = (g: string, re: RegExp) => Number(g.match(re)![1]);
  const left = (g: string) => num(g, /<line class="head" x1="([\d.]+)"/);

  it.each([
    ['endpoint', /<rect class="card" [^>]*rx="[\d.]+"\/><line class="head"/, '⇄'],
    ['service', /<rect class="card" [^>]*rx="12"\/><line class="head"/, '⚙'],
    ['component', /<rect class="card" [^>]*rx="2"\/><path class="deco" d="M[\d.]+,[\d.]+ V[\d.]+ M[\d.]+,[\d.]+ V[\d.]+"\/>/, '▣'],
    ['table', /<rect class="card" [^>]*rx="6"\/><path class="deco" d="(M[\d.]+,[\d.]+ V[\d.]+ ?){3}"\/>/, '▤'],
    ['model', /<rect class="card" [^>]*rx="6"\/><line class="head"[^>]*\/><line class="head"/, '◉'],
    ['enum', /<path class="card" d="M[\d.]+,[\d.]+ H[\d.]+ L[\d.]+,[\d.]+ V[\d.]+ L[\d.]+,[\d.]+ H[\d.]+ L[\d.]+,[\d.]+ V[\d.]+ Z"\/>/, '◇'],
    ['config', /<path class="card" d="M[\d.]+,[\d.]+ H[\d.]+ V[\d.]+ H[\d.]+ L[\d.]+,[\d.]+ Z"\/>/, '⚑'],
    ['file', /<path class="card"[^>]*\/><path class="fold"/, '≡'],
    ['other', /<rect class="card" [^>]*rx="6"\/><line class="head"/, undefined],
  ] as const)('a %s node has its own outline and icon', async (kind, outline, icon) => {
    const g = await nodeG(kind);
    expect(g).toMatch(outline);
    if (icon) expect(g).toMatch(new RegExp(`<text class="kind-icon"[^>]*>${icon}</text><text class="kind"[^>]*>${kind}<`));
    else expect(g).not.toMatch(/class="kind(-icon)?"/);
  });

  it('no two kinds share an outline', async () => {
    const outlines = await Promise.all(
      KINDS.map(async (k) => {
        const g = await nodeG(k);
        return g.slice(g.search(/<(rect|path) class="card"/), g.indexOf('<text')).replace(/ (x|y|width|height)="[\d.-]+"/g, '').replace(/d="[^"]*"/g, (d) => d.replace(/[\d.-]+/g, '#'));
      }),
    );
    expect(new Set(outlines).size).toBe(KINDS.length);
  });

  it('a pill, a tag and a component move their text clear of the curve, the point and the rails', async () => {
    for (const [kind, inset] of [['endpoint', 18], ['config', 17], ['component', 14], ['service', 8]] as const) {
      const g = await nodeG(kind);
      expect(num(g, /class="label" x="([\d.]+)"/) - left(g)).toBeCloseTo(inset, 5);
      expect(num(g, /class="kind-icon" x="([\d.]+)"/) - left(g)).toBeCloseTo(inset, 5);
    }
    const pill = await nodeG('endpoint');
    expect(num(pill, /<line class="head"[^>]* x2="([\d.]+)"/) - num(pill, /class="badge" x="([\d.]+)"/)).toBeCloseTo(18, 5);
  });

  it('status still drives the stroke of every shape', { timeout: 15_000 }, async () => {
    for (const status of ['new', 'changed', 'removed', 'config', 'context']) {
      for (const kind of KINDS) expect(await nodeG(kind, status)).toMatch(/<(rect|path) class="card"/);
    }
    for (const status of ['new', 'changed', 'removed', 'config']) expect(CSS).toContain(`.status-${status} :is(.card,.fold,.deco){stroke:var(--`);
    expect(CSS).not.toMatch(/\.shape-[a-z]+ :is\(\.card/);
    expect(CSS).not.toMatch(/\.shape-[a-z]+[^{]*\{[^}]*stroke/);
  });

  it('icons are tinted by variables defined for light and dark (the dark set is in two blocks)', () => {
    for (const k of KINDS.filter((k) => k !== 'other')) {
      expect(CSS).toContain(`.shape-${k} .kind-icon{fill:var(--k-${k})}`);
      expect(CSS.match(new RegExp(`--k-${k}:`, 'g'))).toHaveLength(3);
    }
  });

  it('the tickbox and the flag sit on the corner of a pill, a cut shape, a tag and a fold', async () => {
    const tick = (g: string) => num(g, /class="tick-box" x="([\d.-]+)"/) + 6 - left(g);
    expect(tick(await nodeG('service'))).toBeCloseTo(0, 5);
    expect(tick(await nodeG('endpoint'))).toBeGreaterThan(3);
    expect(tick(await nodeG('enum'))).toBeCloseTo(4.5, 5);
    expect(tick(await nodeG('config'))).toBeCloseTo(11, 5);
    const right = async (kind: string) => {
      const g = await nodeG(kind, 'changed', true);
      return num(g, /<line class="head"[^>]* x2="([\d.]+)"/) - num(g, /class="flag" x="([\d.-]+)"/);
    };
    expect(await right('service')).toBeCloseTo(0, 5);
    expect(await right('file')).toBeCloseTo(18, 5);
    expect(await right('endpoint')).toBeGreaterThan(3);
    expect(await right('enum')).toBeCloseTo(4.5, 5);
    expect(await right('config')).toBeCloseTo(0, 5);
  });

  it('the panel title names the kind, except other', async () => {
    const spec = loadFixture();
    spec.nodes[0] = { ...spec.nodes[0]!, label: 'aws_lb.api', kind: 'other', status: 'changed' };
    const out = await html(spec);
    expect(out).toContain('<span>aws_lb.api (changed)</span></h2>');
    expect(out).toMatch(/<h2 class="ptitle"><input [^>]*><span>[^<]+ \((new|changed|removed|context|config) (table|enum|model|service|endpoint|component|file|config)\)<\/span><\/h2>/);
  });

  it('cards are keyboard focusable buttons with aria-label', async () => {
    const spec = loadFixture();
    const out = await html(spec);
    const n = spec.nodes[0]!;
    const tag = out.match(new RegExp('<g class="node[^>]*data-id="' + n.id + '"[^>]*>'))![0];
    expect(tag).toContain('tabindex="0"');
    expect(tag).toContain('role="button"');
    expect(tag).toContain(`aria-label="${n.label} (${n.status} ${n.kind})"`);
    expect(out).toContain('.node:focus-visible .card{');
  });

  it('escapes quotes in aria-label', async () => {
    const spec = loadFixture();
    spec.nodes[0] = { ...spec.nodes[0]!, label: 'a" onclick="x' };
    const out = await html(spec);
    expect(out).toContain('aria-label="a&quot; onclick=&quot;x (');
    expect(out).not.toContain('aria-label="a" onclick');
  });

  it('canvas disables touch gestures and client handles pointercancel', async () => {
    const out = await html(loadFixture());
    expect(out).toMatch(/\.canvas\{[^}]*touch-action:none/);
    expect(out).toContain("addEventListener('pointercancel'");
    expect(out).toContain("addEventListener('keydown'");
  });

  describe('theme', () => {
    const withTheme = async (theme?: Theme): Promise<string> => {
      const spec = loadFixture();
      return renderHtml(spec, await layoutSpec(spec), theme ? { ...meta, theme } : meta);
    };
    it('theme dark sets data-theme on <html>', async () => {
      expect(await withTheme('dark')).toMatch(/<html [^>]*data-theme="dark"/);
    });
    it('defaults to auto', async () => {
      expect(await withTheme()).toMatch(/<html [^>]*data-theme="auto"/);
    });
    it('css has media-query block and forced dark block', async () => {
      const out = await withTheme();
      expect(out).toMatch(/@media \(prefers-color-scheme: dark\)\{:root\[data-theme="auto"\]\{/);
      expect(out).toContain(':root[data-theme="dark"]{');
    });
    it('invalid theme falls back to auto', async () => {
      const out = await withTheme('x" onload="alert(1)' as unknown as Theme);
      expect(out).toMatch(/<html [^>]*data-theme="auto"/);
      expect(out).not.toContain('onload=');
    });
    it('has a toggle button', async () => {
      expect(await withTheme()).toContain('<button id="theme-toggle"');
    });
  });
});

describe('the build time in the header', () => {
  it('reads as a local day and time, with the exact instant in datetime and title', async () => {
    expect(prettyDate(new Date(2026, 10, 6, 9, 4))).toBe('6 Nov 2026, 09:04');
    const page = await html(loadFixture());
    expect(page).toContain('<time datetime="2026-10-27T12:00:00.000Z" title="2026-10-27T12:00:00.000Z">');
  });
});
