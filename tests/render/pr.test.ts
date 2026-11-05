import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MapCheck } from '../../src/render/check.js';
import { prBlock, renderSvg } from '../../src/render/pr.js';
import { layoutSpec } from '../../src/render/web/layout.js';
import { validateSpec, type Spec } from '../../src/spec/schema.js';

const shop = (): Spec => {
  const result = validateSpec(JSON.parse(readFileSync(new URL('../fixtures/shop.spec.json', import.meta.url), 'utf8')));
  if (!result.ok || result.spec.diagram === 'flow') throw new Error('bad fixture');
  return result.spec as Spec;
};

const node = (label: string, extra: Partial<Spec['nodes'][number]> = {}): Spec['nodes'][number] => ({
  id: 'a',
  label,
  kind: 'service',
  status: 'new',
  layer: 'backend',
  ...extra,
});

const check = (over: Partial<MapCheck> = {}): MapCheck => ({ checked: 2, unit: 'node', mismatches: [], found: new Map(), matches: new Map(), ...over }) as MapCheck;

describe('renderSvg', () => {
  it('a standalone SVG with the page stylesheet, scripts left out', async () => {
    const spec = shop();
    const svg = renderSvg(spec, await layoutSpec(spec), undefined);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" data-theme="auto" viewBox="-10 -10 ')).toBe(true);
    expect(svg).toContain('<style>');
    expect(svg).toContain('prefers-color-scheme: dark');
    expect(svg).toContain('class="node status-new');
    expect(svg).not.toContain('<script');
  });

  it('escapes labels', async () => {
    const spec: Spec = { title: '<t>', kind: 'summary', nodes: [node('<img src=x onerror=alert(1)>')], edges: [] };
    const svg = renderSvg(spec, await layoutSpec(spec), undefined);
    expect(svg).not.toContain('<img');
    expect(svg).toContain('&lt;img src=x');
  });
});

describe('prBlock', () => {
  it('a collapsed section: counts, the image, node details, the spec in a hidden comment', () => {
    const out = prBlock(shop(), undefined, 'https://example.com/map (1).svg');
    expect(out.startsWith('<!-- codechart:start -->\n<details><summary>Map: Invoices for paid orders</summary>\n\n12 nodes · 4 new · 5 changed\n')).toBe(true);
    expect(out).toContain('[![Invoices for paid orders](https://example.com/map%20%281%29.svg)](https://example.com/map%20%281%29.svg)');
    expect(out).toContain('<details><summary>Node details (12)</summary>');
    expect(out).toContain('- **+ invoices** · new table · `shop/models/invoice.py`\n  - One invoice per paid order\n  - Fields: id: uuid (PK) · + order_id');
    expect(out).toMatch(/<\/details>\n\n<!-- codechart spec\n\{.*\}\n-->\n<!-- codechart:end -->\n$/);
  });

  it('new nodes come first in the details, context last', () => {
    const out = prBlock(shop(), undefined, 'x');
    expect(out.indexOf('**+ invoices**')).toBeLessThan(out.indexOf('**\\~ orders**'));
    expect(out.indexOf('**\\~ orders**')).toBeLessThan(out.indexOf('**customers**'));
  });

  it('groups mismatches by reason with what each means, and caps long file lists', () => {
    const c = check({
      mismatches: [
        { id: 'tbl.orders', label: '~orders', short: 'file missing', detail: 'shop/models/order.py does not exist' },
        { id: 'tbl.invoices', label: '+invoices', short: 'file missing', detail: 'shop/models/invoice.py does not exist' },
        { id: 'py.Invoice', label: '+Invoice', short: 'not in diff', detail: 'not changed in the diff' },
      ],
      uncovered: Array.from({ length: 10 }, (_, i) => `src/f${i}.ts`),
    });
    const out = prBlock(shop(), c, 'x');
    expect(out).toContain("- **✗ file missing** (2): \\~ orders, + invoices. The agent pointed this box at a file that isn't in the repo");
    expect(out).toContain('- **✗ not in diff** (1): + Invoice. The agent says this changed');
    expect(out).toContain('`src/f7.ts`, +2 more. The diff changes these files');
    expect(out).toContain('  - ✗ shop/models/order.py does not exist');
  });

  it('says when the diff was not checked', () => {
    expect(prBlock(shop(), check({ diffUnchecked: true }), 'x')).toContain('- **Diff not checked.** Rendered without --git');
  });

  it('agent text cannot add HTML or break a code span', () => {
    const spec: Spec = { title: '<b>t</b>', kind: 'summary', nodes: [node('a `b` <i>c</i>', { path: 'src/`x`.ts' })], edges: [], omitted: ['<script>x</script>'] };
    const out = prBlock(spec, undefined, 'x');
    expect(out).toContain('<summary>Map: &lt;b&gt;t&lt;/b&gt;</summary>');
    expect(out).toContain("**+ a 'b' &lt;i&gt;c&lt;/i&gt;**");
    expect(out).toContain('`src/x.ts`');
    expect(out).toContain('&lt;script&gt;x&lt;/script&gt;');
  });

  it('the hidden spec cannot end its comment early, and reads back as the same spec', () => {
    const spec: Spec = { title: 't', kind: 'summary', nodes: [node('a --> b --!> c <!--')], edges: [] };
    const out = prBlock(spec, undefined, 'x');
    const comment = out.slice(out.indexOf('<!-- codechart spec'), out.indexOf('<!-- codechart:end -->'));
    expect(comment.indexOf('-->')).toBe(comment.length - 4);
    expect(JSON.parse(comment.split('\n')[1]!)).toEqual(spec);
  });
});
