import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Spec, Status } from '../../src/spec/schema.js';
import { selectTerminalNodes } from '../../src/render/terminal/select.js';
import { renderLinks } from '../../src/render/terminal/links.js';
import { columns, flat, truncate } from '../../src/render/terminal/wrap.js';
import { defaultWidth, renderTerminal } from '../../src/render/terminal/render.js';

const teams = JSON.parse(
  readFileSync(new URL('../fixtures/shop.spec.json', import.meta.url), 'utf8'),
) as Spec;

const ESC = '\u001b';

function makeSpec(statusOf: Record<string, Status>, edges: [string, string][]): Spec {
  return {
    title: 't',
    kind: 'plan',
    nodes: Object.entries(statusOf).map(([id, status]) => ({
      id,
      label: id,
      kind: 'other',
      status,
      layer: 'l',
    })),
    edges: edges.map(([from, to]) => ({ from, to })),
  };
}

describe('selectTerminalNodes', () => {
  it('new/changed/config included, context only if it is an edge endpoint', () => {
    const spec = makeSpec(
      { n: 'new', c: 'changed', g: 'config', linked: 'context', lone: 'context' },
      [['linked', 'c']],
    );
    const { ids, hidden } = selectTerminalNodes(spec, 10);
    expect([...ids].sort()).toEqual(['c', 'g', 'linked', 'n']);
    expect(hidden).toBe(0);
  });

  it('over max keeps highest-degree nodes, hidden = rest', () => {
    const spec = makeSpec(
      { a: 'changed', b: 'changed', hub: 'changed', c: 'new', d: 'changed' },
      [['a', 'hub'], ['b', 'hub'], ['c', 'hub'], ['a', 'b']],
    );
    const { ids, hidden } = selectTerminalNodes(spec, 3);
    expect([...ids].sort()).toEqual(['a', 'b', 'hub']);
    expect(hidden).toBe(2);
  });

  it('over max: new/changed outrank a higher-degree context hub', () => {
    const spec = makeSpec(
      { hub: 'context', a: 'changed', b: 'changed', c: 'changed', lone: 'new' },
      [['a', 'hub'], ['b', 'hub'], ['c', 'hub']],
    );
    const { ids, hidden } = selectTerminalNodes(spec, 4);
    expect([...ids].sort()).toEqual(['a', 'b', 'c', 'lone']);
    expect(hidden).toBe(1);
  });

  it('over max: config fills slots before context', () => {
    const spec = makeSpec(
      { n: 'new', g1: 'config', g2: 'config', ctx: 'context' },
      [['ctx', 'n'], ['ctx', 'g1'], ['ctx', 'g2'], ['n', 'g1']],
    );
    const { ids, hidden } = selectTerminalNodes(spec, 3);
    expect([...ids].sort()).toEqual(['g1', 'g2', 'n']);
    expect(hidden).toBe(1);
  });

  it('no new/changed nodes → falls back to all nodes up to max', () => {
    const spec = makeSpec({ x: 'context', y: 'context', z: 'context' }, [['x', 'y']]);
    expect([...selectTerminalNodes(spec, 10).ids].sort()).toEqual(['x', 'y', 'z']);
    const capped = selectTerminalNodes(spec, 2);
    expect([...capped.ids].sort()).toEqual(['x', 'y']);
    expect(capped.hidden).toBe(1);
  });
});

const linkSpec = (labels: (string | undefined)[], sourceLabel = 'src'): Spec => ({
  title: 't',
  kind: 'plan',
  nodes: [
    { id: 's', label: sourceLabel, kind: 'other', status: 'new', layer: 'database' },
    ...labels.map((_, i) => ({ id: `t${i}`, label: `t${i}`, kind: 'table', status: 'changed', layer: 'database' }) as const),
  ],
  edges: labels.map((label, i) => ({ from: 's', to: `t${i}`, ...(label !== undefined && { label }) })),
});
const allIds = (spec: Spec) => new Set(spec.nodes.map((n) => n.id));

describe('renderLinks', () => {
  it('a source with 3 links → written once, arrows aligned', () => {
    const spec = linkSpec(['adds is_deleted', 'adds CHECK', undefined]);
    expect(renderLinks(spec, allIds(spec), 100, false)).toBe(
      [
        'database',
        '  +src ─adds is_deleted─▶ ~t0',
        '       ─adds CHECK──────▶ ~t1',
        '       ─────────────────▶ ~t2',
      ].join('\n'),
    );
  });

  it('no-label link alone is ──▶', () => {
    const spec = makeSpec({ a: 'new', b: 'changed' }, [['a', 'b']]);
    expect(renderLinks(spec, allIds(spec), 100, false)).toBe('l\n  +a ──▶ ~b');
  });

  it('target shows kind except table/file/other/config; source never shows kind', () => {
    const out = renderLinks(teams, allIds(teams), 100, false);
    expect(out).toContain('  ~orders ─customer_id─▶ ·customers\n          ─status──────▶ ~enum order_status');
    expect(out).toContain('  +Invoice ─maps─▶ +invoices');
    expect(out).toContain('  ◆feature flag refundsEnabled ─gates─▶ +endpoint POST /orders/{id}/refund');
    expect(out).toContain('  +POST /orders/{id}/refund ─sets refunded─▶ ~model OrderStatus');
  });

  it('link to a hidden node not shown', () => {
    const spec = linkSpec(['a', 'b']);
    const out = renderLinks(spec, new Set(['s', 't0']), 100, false);
    expect(out).toBe('database\n  +src ─a─▶ ~t0');
    expect(renderLinks(spec, new Set(['s']), 100, false)).toBe('');
  });

  it('long source label cut with …', () => {
    const spec = linkSpec(['x'], 'y'.repeat(40));
    const line = renderLinks(spec, allIds(spec), 60, false).split('\n')[1]!;
    expect(line).toBe(`  +${'y'.repeat(18)}… ─x─▶ ~t0`);
  });

  it('long edge label cut with … then target cut, every line ≤ width', () => {
    const spec = linkSpec(['l'.repeat(60), 'short']);
    spec.nodes[2]!.label = 'T'.repeat(80);
    const out = renderLinks(spec, allIds(spec), 40, false).split('\n');
    for (const line of out) expect(columns(line)).toBeLessThanOrEqual(40);
    expect(out[1]).toBe(`  +src ─${'l'.repeat(12)}…─▶ ~t0`);
    expect(out[2]).toBe(`       ─short${'─'.repeat(9)}▶ ~${'T'.repeat(14)}…`);
  });

  it('one arrow column per source even when a target overflows', () => {
    const spec = linkSpec(['a long label here', 'x']);
    spec.nodes[1]!.label = 'short';
    spec.nodes[2]!.label = 'c'.repeat(80);
    const out = renderLinks(spec, allIds(spec), 60, false).split('\n').slice(1);
    expect(new Set(out.map((l) => [...l].indexOf('▶'))).size).toBe(1);
    for (const line of out) expect(columns(line)).toBeLessThanOrEqual(60);
    expect(out[1]).toMatch(/c…$/);
  });

  it('tiny width keeps color on the visible label', () => {
    const spec = makeSpec({ a: 'new', b: 'changed' }, [['a', 'b']]);
    spec.nodes[0]!.label = 'abcdef';
    const out = renderLinks(spec, allIds(spec), 6, true).split('\n')[1]!;
    expect(out).toBe(`  ${ESC}[32m+…${ESC}[0m …`);
    expect(columns(out)).toBeLessThanOrEqual(6);
  });

  it('flattens control characters', () => {
    const spec = makeSpec({ a: 'new', b: 'changed' }, [['a', 'b']]);
    spec.nodes[0]!.label = 'tab\there';
    spec.edges[0]!.label = 'reads\nconfig';
    expect(renderLinks(spec, allIds(spec), 100, false)).toBe('l\n  +tab here ─reads config─▶ ~b');
  });

  it('color paints only labels', () => {
    const spec = makeSpec({ a: 'new', b: 'changed' }, [['a', 'b']]);
    expect(renderLinks(spec, allIds(spec), 100, true)).toBe(`l\n  ${ESC}[32m+a${ESC}[0m ──▶ ${ESC}[33m~b${ESC}[0m`);
  });
});

describe('defaultWidth', () => {
  it('TTY → min(columns, 100)', () => {
    expect(defaultWidth({ isTTY: true, columns: 140 }, {})).toBe(100);
    expect(defaultWidth({ isTTY: true, columns: 70 }, { COLUMNS: '50' })).toBe(70);
    expect(defaultWidth({ isTTY: true, columns: 0 }, {})).toBe(100);
  });

  it('non-TTY default width = COLUMNS or 80', () => {
    expect(defaultWidth({ isTTY: false }, { COLUMNS: '120' })).toBe(120);
    expect(defaultWidth({ isTTY: false }, {})).toBe(80);
    expect(defaultWidth({ isTTY: false }, { COLUMNS: 'abc' })).toBe(80);
    expect(defaultWidth({ isTTY: false }, { COLUMNS: '0' })).toBe(80);
    expect(defaultWidth({ isTTY: false }, { COLUMNS: 'Infinity' })).toBe(80);
    expect(defaultWidth({ isTTY: false }, { COLUMNS: '1e3' })).toBe(80);
    expect(defaultWidth({ isTTY: false }, { COLUMNS: '300' })).toBe(300);
  });
});

describe('renderTerminal', () => {
  it('shop grouped list', () => {
    const out = renderTerminal(teams, { maxNodes: 20, width: 100, color: false });
    expect(out).toMatchSnapshot();
    expect(out).toContain('12 nodes · 4 new · 5 changed · 2 config');
    expect(out.startsWith('database\n  ~orders ')).toBe(true);
  });

  it('no ascii-dag output (no "Edge labels:", no "--- text")', () => {
    for (const width of [100, 60]) {
      const out = renderTerminal(teams, { maxNodes: 20, width, color: false });
      expect(out).not.toContain('Edge labels:');
      expect(out).not.toContain('--- text');
      expect(out).not.toContain('--- database');
      expect(out).not.toMatch(/[[\]┐┘├]/);
    }
  });

  it('every link appears exactly once', () => {
    const out = renderTerminal(teams, { maxNodes: 20, width: 100, color: false });
    expect(out.match(/▶/g)).toHaveLength(teams.edges.length);
  });

  it('width 60 → every line ≤ 60', () => {
    const out = renderTerminal(teams, { maxNodes: 20, width: 60, color: false });
    expect(out).toMatchSnapshot();
    for (const line of out.split('\n')) expect(columns(line)).toBeLessThanOrEqual(60);
  });

  it('width below 20 is clamped to 20', () => {
    for (const width of [1, 6, 10]) {
      const out = renderTerminal(teams, { maxNodes: 20, width, color: false });
      for (const line of out.split('\n').filter((l) => !l.startsWith('full map'))) {
        expect(columns(line), line).toBeLessThanOrEqual(20);
      }
      expect(out).toBe(renderTerminal(teams, { maxNodes: 20, width: 20, color: false }));
    }
  });

  it('also: with color wraps by visible width and closes color on every line', () => {
    const spec = makeSpec({ a: 'new', b: 'changed', c: 'removed' }, []);
    spec.nodes[0]!.label = 'app/services/invoice_numbering_service.py';
    spec.nodes[1]!.label = 'short one';
    {
      const out = renderTerminal(spec, { maxNodes: 20, width: 20, color: true });
      const also = out.slice(out.indexOf('also:'), out.indexOf('\n\n', out.indexOf('also:'))).split('\n');
      expect(also.length).toBeGreaterThan(1);
      for (const line of also) {
        expect(columns(line), line).toBeLessThanOrEqual(20);
        expect(line.replace(/\u001b\[[0-9;]*m/g, ''), line).not.toContain(ESC);
        const opens = line.match(/\u001b\[3\dm/g)?.length ?? 0;
        expect(line.match(/\u001b\[0m/g)?.length ?? 0, line).toBe(opens);
      }
      expect(also.join('').replace(/\u001b\[[0-9;]*m/g, '').replace(/\s+/g, '')).toContain(
        'app/services/invoice_numbering_service.py',
      );
    }
  });

  it('keyLine: false drops the key line', () => {
    const out = renderTerminal(teams as Spec, { maxNodes: 20, width: 80, color: false, keyLine: false });
    expect(out).not.toContain('key:');
    expect(out).toContain('12 nodes · 4 new · 5 changed · 2 config\n');
  });

  it('footer says not on map:', () => {
    const out = renderTerminal({ ...teams, omitted: ['audit log'] } as Spec, { maxNodes: 20, width: 80, color: false });
    expect(out).toContain('not on map: audit log');
    expect(out).not.toContain('omitted:');
  });

  it('footer has the key line', () => {
    const out = renderTerminal(teams, { maxNodes: 20, width: 100, color: false });
    expect(out).toContain('12 nodes · 4 new · 5 changed · 2 config\nkey: + new  - removed  ~ changed  · context  ◆ config\n');
  });

  it('footer lists gaps, omitted, "+N more in web view", "full map → file://…" when htmlPath set', () => {
    const out = renderTerminal(teams, {
      maxNodes: 5,
      width: 100,
      htmlPath: 'out/shop.html',
      color: false,
    });
    expect(out).toContain('customers: columns besides id not read');
    expect(out).toContain('tests: test_invoice_backfill.py');
    expect(out).toContain('docs: CHANGELOG.md, .env.example');
    expect(out).toMatch(/\+\d+ more in web view/);
    expect(out).toContain(`full map → ${pathToFileURL(resolve('out/shop.html')).href}`);

    const plain = renderTerminal(teams, { maxNodes: 20, width: 100, color: false });
    expect(plain).not.toContain('more in web view');
    expect(plain).not.toContain('full map');
  });

  it('hidden nodes without htmlPath -> "+N more not shown"', () => {
    const out = renderTerminal(teams, { maxNodes: 5, width: 100, color: false });
    expect(out).toMatch(/\+\d+ more not shown/);
    expect(out).not.toContain('more in web view');
  });

  it('never prints two consecutive blank lines', () => {
    for (const width of [100, 60]) {
      expect(renderTerminal(teams, { maxNodes: 20, width, color: false })).not.toMatch(/\n\n\n/);
    }
  });

  it('lists selected nodes with no shown link on an "also" line', () => {
    const spec = {
      ...teams,
      nodes: [
        ...teams.nodes,
        { id: 'lone', label: 'lonely', kind: 'file', status: 'new', layer: 'config' },
        { id: 'lone2', label: 'solo', kind: 'file', status: 'changed', layer: 'config' },
      ],
    } as Spec;
    const out = renderTerminal(spec, { maxNodes: 20, width: 100, color: false });
    expect(out).toContain('\nalso: +lonely · ~solo\n');
    expect(renderTerminal(teams, { maxNodes: 20, width: 100, color: false })).not.toContain('also:');
  });

  it('breaks a footer item longer than width at spaces, keeping the text', () => {
    const gap = 'the customers table has many more columns than were read during this change, see notes';
    const spec = { ...teams, gaps: [gap, 'short one'], omitted: ['x'.repeat(70)] } as Spec;
    const out = renderTerminal(spec, { maxNodes: 20, width: 60, color: false });
    const footer = out.slice(out.indexOf('12 nodes')).trimEnd().split('\n');
    for (const line of footer) expect(columns(line)).toBeLessThanOrEqual(60);
    const joined = (head: string, next: string) => {
      const from = footer.findIndex((l) => l.startsWith(head));
      const to = footer.findIndex((l) => l.startsWith(next));
      return footer.slice(from, to).join(' ').replace(/\s+/g, ' ');
    };
    expect(joined('gaps: ', 'not on map: ')).toBe(`gaps: ${gap} · short one`);
    expect(footer.filter((l) => l.startsWith('not on map: ') || l.startsWith(' '.repeat('not on map: '.length))).join('').replace(/\s+|not on map:/g, '')).toBe('x'.repeat(70));
  });

  it('truncates a layer header to width', () => {
    const layer = 'a-really-long-layer-name-that-goes-on-and-on-and-on-and-on-forever';
    const spec = { ...teams, nodes: teams.nodes.map((n) => (n.layer === 'database' ? { ...n, layer } : n)) } as Spec;
    const out = renderTerminal(spec, { maxNodes: 20, width: 60, color: false });
    const header = out.split('\n').find((l) => l.startsWith('a-really'))!;
    expect(columns(header)).toBe(60);
    expect(header.endsWith('…')).toBe(true);
  });

  it('shop plain at width 80', () => {
    expect(renderTerminal(teams, { maxNodes: 20, width: 80, color: false })).toMatchSnapshot();
  });

  it('blank line between layers', () => {
    const out = renderTerminal(teams, { maxNodes: 20, width: 100, color: false });
    const layers = [...new Set(teams.nodes.map((n) => n.layer))].filter((l) => out.includes(`\n${l}\n`) || out.startsWith(`${l}\n`));
    expect(layers.length).toBeGreaterThan(1);
    expect(out.startsWith(`${layers[0]}\n`)).toBe(true);
    for (const layer of layers.slice(1)) expect(out).toContain(`\n\n${layer}\n`);
  });

  it('no icons option: markers always plain', () => {
    // @ts-expect-error icons was removed
    renderTerminal(teams, { maxNodes: 20, width: 100, color: false, icons: true });
  });

  it('count line shows removed only when present', () => {
    const plain = renderTerminal(teams, { maxNodes: 20, width: 100, color: false });
    expect(plain).toContain('12 nodes · 4 new · 5 changed · 2 config\n');
    const spec = makeSpec({ a: 'new', r: 'removed', s: 'removed' }, [['a', 'r']]);
    const out = renderTerminal(spec, { maxNodes: 20, width: 100, color: false });
    expect(out).toContain('3 nodes · 1 new · 0 changed · 2 removed · 0 config\n');
  });

  it('color:false → no ANSI escapes', () => {
    expect(renderTerminal(teams, { maxNodes: 20, width: 100, color: false })).not.toContain(ESC);
    expect(renderTerminal(teams, { maxNodes: 20, width: 100, color: true })).toContain(ESC);
  });
});

describe('markers', () => {
  const statusSpec = () => {
    const spec = makeSpec({ n: 'new', c: 'changed', r: 'removed', x: 'context', g: 'config' }, [
      ['n', 'c'], ['n', 'r'], ['x', 'g'],
    ]);
    spec.nodes[1]!.kind = 'enum';
    return spec;
  };

  it('plain markers and key line plain', () => {
    const out = renderTerminal(statusSpec(), { maxNodes: 20, width: 100, color: false });
    expect(out).toContain('  +n ──▶ ~enum c\n     ──▶ -r\n');
    expect(out).toContain('  ·x ──▶ ◆g');
    expect(out).toContain('key: + new  - removed  ~ changed  · context  ◆ config\n');
    expect(out).not.toMatch(/[✅❌✏⚪⚙]/u);
  });

  it('removed is selected with new/changed, outranking config and context', () => {
    const spec = makeSpec({ r: 'removed', g: 'config', x: 'context' }, [['x', 'r'], ['x', 'g']]);
    const { ids } = selectTerminalNodes(spec, 1);
    expect([...ids]).toEqual(['r']);
    expect([...selectTerminalNodes(makeSpec({ r: 'removed', y: 'context' }, []), 5).ids]).toEqual(['r']);
  });

  it('removed nodes show no fields', () => {
    const spec = makeSpec({ r: 'removed' }, []);
    spec.nodes[0]!.fields = [{ name: 'gone', change: 'removed' }];
    expect(renderTerminal(spec, { maxNodes: 20, width: 100, color: false })).not.toContain('fields:');
  });

  it('field markers and head label plain', () => {
    const spec = makeSpec({ c: 'changed' }, []);
    spec.nodes[0]!.fields = [{ name: 'a', change: 'added' }, { name: 'b', change: 'removed' }];
    const out = renderTerminal(spec, { maxNodes: 20, width: 100, color: false });
    expect(out).toContain('fields:\n~c  +a · -b\n');
  });

  it('emoji in labels counted as 2 columns: arrows aligned, every line ≤ width', () => {
    expect(columns('✅')).toBe(2);
    expect(columns('✏️')).toBe(2);
    expect(columns('⚙️ x')).toBe(4);
    expect(columns('❌⚪')).toBe(4);
    expect(truncate('✏️ abcdef', 5)).toBe('✏️ a…');
    expect(truncate('✅✅✅', 4)).toBe('✅…');
    const emoji = { ...teams, nodes: teams.nodes.map((n, i) => (i % 2 ? { ...n, label: `✅ ${n.label}` } : n)) } as Spec;
    for (const width of [100, 80, 60, 40]) {
      const out = renderTerminal(emoji, { maxNodes: 20, width, color: false });
      for (const line of out.split('\n').filter((l) => !l.startsWith('full map'))) {
        expect(columns(line), line).toBeLessThanOrEqual(width);
      }
      const blocks = out.split('\nfields:')[0]!.split('\n').filter((l) => l.startsWith('  '));
      const groups: string[][] = [];
      for (const l of blocks) (l.startsWith('   ') ? groups.at(-1)! : (groups[groups.length] = [])).push(l);
      for (const g of groups) {
        const at = g.map((l) => columns(l.slice(0, l.indexOf('▶'))));
        expect(new Set(at).size, g.join('\n')).toBe(1);
      }
    }
  });
});

describe('fields section', () => {
  const fieldSpec = (): Spec => {
    const spec = makeSpec({ n: 'new', c: 'changed', x: 'context', k: 'config' }, []);
    const [n, c, x, k] = spec.nodes;
    n!.fields = [{ name: 'id', type: 'uuid PK' }, { name: 'name', type: 'text unique' }, { name: 'bare' }];
    c!.fields = [
      { name: 'old', type: 'int' },
      { name: 'team_id', type: 'uuid FK', change: 'added' },
      { name: 'gone', change: 'removed' },
      { name: 'role', type: 'enum', change: 'modified', note: 'ignored' },
    ];
    x!.fields = [{ name: 'ctx', change: 'added' }];
    k!.fields = [{ name: 'cfg', change: 'added' }];
    return spec;
  };
  const opts = { maxNodes: 20, width: 100, color: false };

  it('no htmlPath → fields section lists new (all) and changed (changed only) fields', () => {
    const out = renderTerminal(fieldSpec(), opts);
    expect(out).toContain(
      'fields:\n+n  id uuid PK · name text unique · bare\n~c  +team_id uuid FK · -gone · ~role enum\n',
    );
    expect(out.indexOf('fields:')).toBeLessThan(out.indexOf('4 nodes'));
    expect(out).not.toContain('old');
    expect(out).not.toContain('cfg');
  });

  it('htmlPath set → no fields section', () => {
    expect(renderTerminal(fieldSpec(), { ...opts, htmlPath: 'out/x.html' })).not.toContain('fields:');
  });

  it('context node fields never shown', () => {
    expect(renderTerminal(fieldSpec(), opts)).not.toContain('ctx');
  });

  it('width 40 → wrapped, every line ≤ 40', () => {
    const out = renderTerminal(fieldSpec(), { ...opts, width: 40 });
    expect(out).toContain('fields:');
    for (const line of out.split('\n')) expect(columns(line)).toBeLessThanOrEqual(40);
  });

  it('one long label at width 40 → label cut with …, every line ≤ 40', () => {
    const spec = fieldSpec();
    spec.nodes[0]!.label = 'x'.repeat(50);
    const out = renderTerminal(spec, { ...opts, width: 40 });
    expect(out).toMatch(/\n\+x+…  id uuid PK/);
    for (const line of out.split('\n')) expect(columns(line)).toBeLessThanOrEqual(40);
  });

  it('tiny width → clamped to 20, fields header intact', () => {
    const out = renderTerminal(fieldSpec(), { ...opts, width: 6 });
    expect(out).toContain('\nfields:\n');
    for (const line of out.split('\n')) expect(columns(line)).toBeLessThanOrEqual(20);
  });

  it('no node has fields → no section', () => {
    expect(renderTerminal(makeSpec({ a: 'new' }, []), opts)).not.toContain('fields:');
  });

  it('color paints only the head label', () => {
    const out = renderTerminal(fieldSpec(), { ...opts, color: true });
    expect(out).toContain(`${ESC}[32m+n${ESC}[0m  id uuid PK`);
  });
});

describe('flat', () => {
  it('replaces control chars with a single space', () => {
    expect(flat('one\ntwo\r\n\tthree')).toBe('one two three');
  });
});
