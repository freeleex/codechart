import { describe, expect, it } from 'vitest';
import { renderFlowHtml } from '../../src/render/flow/html.js';
import { layoutFlow } from '../../src/render/flow/layout.js';
import { sampleFlow, sampleSnippets } from './flow-fixture.js';

const meta = { generatedAt: new Date('2026-10-27T12:00:00Z'), repo: 'demo' };

async function html(spec = sampleFlow(), snippets = sampleSnippets()): Promise<string> {
  return renderFlowHtml(spec, await layoutFlow(spec), snippets, meta);
}

const nodeOf = (out: string, id: string) => {
  const m = out.match(new RegExp(`<g class="node ([^"]*)" data-id="${id}"[^>]*>(.*?)</g>`));
  if (!m) throw new Error(`no node ${id}`);
  return { cls: m[1]!, body: m[2]! };
};
const panelOf = (out: string, id: string) =>
  out.match(new RegExp(`<template class="card-panel" data-for="${id}">(.*?)</template>`, 's'))![1]!;

describe('layoutFlow', () => {
  it('lays out top-down', async () => {
    const layout = await layoutFlow(sampleFlow());
    const y = new Map(layout.nodes.map((n) => [n.id, n.y]));
    expect(y.get('read')!).toBeLessThan(y.get('mode')!);
    expect(y.get('mode')!).toBeLessThan(y.get('print')!);
    expect(y.get('web')!).toBeLessThan(y.get('done')!);
  });

  it('one node per step, one edge per link with a path', async () => {
    const spec = sampleFlow();
    const layout = await layoutFlow(spec);
    expect(layout.nodes.map((n) => n.id).sort()).toEqual(spec.steps.map((s) => s.id).sort());
    expect(layout.edges).toHaveLength(spec.links.length);
    for (const e of layout.edges) expect(e.points.length).toBeGreaterThanOrEqual(2);
    expect(layout.edges.filter((e) => e.labelAt)).toHaveLength(3);
  });

  it('wraps long labels instead of clipping', async () => {
    const spec = sampleFlow();
    spec.steps[0]!.label = 'read the whole spec file from disk or from standard input when piped';
    const layout = await layoutFlow(spec);
    const read = layout.nodes.find((n) => n.id === 'read')!;
    expect(read.lines.length).toBeGreaterThan(1);
    expect(read.lines.join(' ')).toContain('read the whole');
  });

  it('branches leave the diamond outline, not its bounding box', async () => {
    const spec = sampleFlow();
    const layout = await layoutFlow(spec);
    const d = layout.nodes.find((n) => n.id === 'mode')!;
    const [cx, cy] = [d.x + d.w / 2, d.y + d.h / 2];
    spec.links.forEach((l, i) => {
      if (l.from !== 'mode') return;
      const p = layout.edges[i]!.points[0]!;
      expect(Math.abs(p.x - cx) / (d.w / 2) + Math.abs(p.y - cy) / (d.h / 2)).toBeCloseTo(1, 1);
    });
  });

  it('handles loops', async () => {
    const spec = sampleFlow();
    spec.links.push({ from: 'web', to: 'read', label: 'retry' });
    const layout = await layoutFlow(spec);
    expect(layout.edges.at(-1)!.points.length).toBeGreaterThanOrEqual(2);
  });
});

describe('renderFlowHtml', () => {
  it('single file: no external script/link/url references', async () => {
    const out = await html();
    expect(out).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(out).not.toMatch(/<link[^>]*\shref=/i);
    expect(out).not.toMatch(/https?:\/\//i);
  });

  it('shapes by type: rect for steps, diamond for decisions, pill for ends', async () => {
    const out = await html();
    const read = nodeOf(out, 'read');
    expect(read.cls).toContain('type-step');
    expect(read.body).toMatch(/<rect class="shape"[^>]* rx="4"/);
    const mode = nodeOf(out, 'mode');
    expect(mode.cls).toContain('type-decision');
    expect(mode.body).toMatch(/<polygon class="shape" points="[\d., -]+"/);
    const print = nodeOf(out, 'print');
    expect(print.cls).toContain('type-end');
    const pill = print.body.match(/<rect class="shape"[^>]* height="([\d.]+)" rx="([\d.]+)"/)!;
    expect(Number(pill[2])).toBeCloseTo(Number(pill[1]) / 2, 0);
  });

  it('labelled arrows', async () => {
    const out = await html();
    const edges = [...out.matchAll(/<g class="edge[^"]*">(.*?)<\/g>/g)];
    expect(edges).toHaveLength(5);
    expect(edges.every((e) => /marker-end="url\(#arrow(-planned)?\)"/.test(e[1]!))).toBe(true);
    expect(edges.filter((e) => /<text[^>]*>cli<\/text>/.test(e[1]!))).toHaveLength(1);
  });

  it('planned steps: dashed and badged; others not', async () => {
    const out = await html();
    for (const id of ['web', 'done']) {
      const n = nodeOf(out, id);
      expect(n.cls).toContain('status-planned');
      expect(n.body).toMatch(/<text class="badge"[^>]*>planned<\/text>/);
    }
    expect(nodeOf(out, 'read').body).not.toContain('class="badge"');
    expect(out).toMatch(/\.status-planned \.shape\{[^}]*stroke-dasharray/);
  });

  it('new and changed steps carry their status badge', async () => {
    const spec = sampleFlow();
    spec.kind = 'summary';
    spec.steps = spec.steps.filter((s) => s.status !== 'planned');
    spec.steps[0]!.status = 'new';
    spec.steps[1]!.status = 'changed';
    spec.links = spec.links.slice(0, 2);
    spec.links.push({ from: 'mode', to: 'read', label: 'again', source: 'src/render.ts:14' });
    const out = await html(spec);
    expect(nodeOf(out, 'read').cls).toContain('status-new');
    expect(nodeOf(out, 'read').body).toMatch(/class="badge"[^>]*>new</);
    expect(nodeOf(out, 'mode').body).toMatch(/class="badge"[^>]*>changed</);
  });

  it('planned links are dashed: planned flag or a planned endpoint', async () => {
    const out = await html();
    const classes = [...out.matchAll(/<g class="(edge[^"]*)">/g)].map((m) => m[1]);
    expect(classes).toEqual(['edge', 'edge', 'edge planned', 'edge planned', 'edge planned']);
    expect(out).toMatch(/\.edge\.planned path\{[^}]*stroke-dasharray/);
    const markers = [...out.matchAll(/<g class="(edge[^"]*)"><path [^>]*marker-end="url\(#([\w-]+)\)"/g)];
    expect(markers.map((m) => [m[1], m[2]])).toEqual([
      ['edge', 'arrow'],
      ['edge', 'arrow'],
      ['edge planned', 'arrow-planned'],
      ['edge planned', 'arrow-planned'],
      ['edge planned', 'arrow-planned'],
    ]);
    expect(out).toContain('<marker id="arrow-planned"');
    expect(out).toMatch(/#arrow-planned path\{fill:var\(--cfg\)\}/);
  });

  it('step panel: status, source and numbered snippet', async () => {
    const tpl = panelOf(await html(), 'read');
    expect(tpl).toContain('existing');
    expect(tpl).toContain('src/render.ts:10-12');
    expect(tpl).toMatch(/<span class="ln">10<\/span>const a = 1;/);
    expect(tpl).toMatch(/<span class="ln">12<\/span>return a;/);
  });

  it('decision panel lists branches with their snippets', async () => {
    const tpl = panelOf(await html(), 'mode');
    expect(tpl).toContain('cli');
    expect(tpl).toContain('print terminal map');
    expect(tpl).toContain('case &quot;cli&quot;: print(map);');
    expect(tpl).toMatch(/none.*?planned/s);
  });

  it('planned step panel says it is not in the code yet', async () => {
    const tpl = panelOf(await html(), 'web');
    expect(tpl).toContain('planned');
    expect(tpl).toMatch(/not in the code yet/i);
    expect(tpl).not.toContain('class="snippet"');
  });

  it('page info: gaps, planned key, info button', async () => {
    const out = await html();
    const info = out.match(/<section id="page-info">(.*?)<\/section>/s)![1]!;
    expect(info).toContain('did not check stdin TTY');
    expect(info).toMatch(/dashed/i);
    expect(out).toContain('id="info-toggle"');
  });

  it('no gaps: no info button', async () => {
    const spec = sampleFlow();
    delete spec.gaps;
    expect(await html(spec)).not.toContain('id="info-toggle"');
  });

  it('escapes snippet code, labels, ids, title and gaps in every context', async () => {
    const evil = `</template></script><script>alert(1)</script>"'><img src=x onerror=alert(2)>`;
    const spec = sampleFlow();
    spec.title = evil;
    spec.gaps = [evil];
    spec.steps[0]!.label = evil;
    spec.steps[0]!.id = `r"'</template>`;
    spec.start = spec.steps[0]!.id;
    spec.links[0]!.from = spec.steps[0]!.id;
    spec.links[1]!.label = evil;
    const snippets = sampleSnippets();
    snippets.steps.set(spec.steps[0]!.id, { source: 'src/a.ts:1', startLine: 1, lines: [evil, '<script>x()</script>'] });
    snippets.links[1] = { source: 'src/a.ts:1', startLine: 1, lines: [evil] };
    const out = await html(spec, snippets);
    expect(out).not.toContain('<script>alert');
    expect(out).not.toContain('<script>x()');
    expect(out).not.toContain('<img');
    expect(out.match(/<script/g)).toHaveLength(2);
    expect(out.match(/<\/script>/g)).toHaveLength(2);
    expect(out.match(/<\/template>/g)).toHaveLength(out.match(/<template /g)!.length);
    expect(out).toContain('data-id="r&quot;&#39;&lt;/template&gt;"');
    expect(out).toContain('&lt;/template&gt;&lt;/script&gt;&lt;script&gt;alert(1)');
  });
});
