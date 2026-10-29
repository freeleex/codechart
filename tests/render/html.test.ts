import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { layoutSpec } from '../../src/render/web/layout.js';
import { renderHtml, type Theme } from '../../src/render/web/html.js';
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
    expect(out).toMatch(new RegExp(`<g class="node status-removed" data-id="${spec.nodes[0]!.id}"[^>]*>.*?<text class="badge"[^>]*>removed</text>`));
    expect(out).toContain('.status-removed .card{stroke:var(--rem)}');
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
      expect(panel).toContain(`<div class="path">${spec.nodes[0]!.path}</div>`);
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
      expect(info).toContain('<h3>Gaps</h3><ul><li>no tests for backfill</li></ul>');
      expect(info).toContain('<h3>Not on map</h3><ul><li>docs/ not drawn</li></ul>');
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

  it('cards are keyboard focusable buttons with aria-label', async () => {
    const spec = loadFixture();
    const out = await html(spec);
    const n = spec.nodes[0]!;
    const tag = out.match(new RegExp('<g class="node[^>]*data-id="' + n.id + '"[^>]*>'))![0];
    expect(tag).toContain('tabindex="0"');
    expect(tag).toContain('role="button"');
    expect(tag).toContain(`aria-label="${n.label} (${n.status})"`);
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
    expect(out).toMatch(/#canvas\{[^}]*touch-action:none/);
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
