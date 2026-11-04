import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkFlowDiff, checkMapNodes, diffOf } from '../../src/render/check.js';
import { alertLine, checkHeadline, checkTag, countLines } from '../../src/render/terminal/check-lines.js';
import type { FlowSpec } from '../../src/spec/flow.js';
import { validateSpec, type Spec, type SpecNode } from '../../src/spec/schema.js';

let base: string;
let repo: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString();

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'codechart-mapcheck-'));
  repo = join(base, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'src/a.ts'), 'export const a = 1;\nexport const b = 2;\nexport const b2 = 2;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

type NodeIn = Partial<SpecNode> & { status: SpecNode['status'] };

const map = (kind: Spec['kind'], ...nodes: NodeIn[]): Spec => ({
  title: 't',
  kind,
  nodes: nodes.map((n, i) => ({ id: `n${i}`, label: `node${i}`, kind: 'file', layer: 'l', ...n })),
  edges: [],
});

const shorts = (s: Spec, diff?: string[]) =>
  checkMapNodes(s, repo, { diff: diff && diffOf(diff) }).mismatches.map((m) => `${m.label} ${m.short}`);

describe('checkMapNodes: file exists', () => {
  it('counts only nodes with a path', () => {
    const r = checkMapNodes(map('summary', { status: 'changed', path: 'src/a.ts' }, { status: 'context', kind: 'table' }), repo);
    expect(r).toMatchObject({ checked: 1, mismatches: [], unit: 'node' });
  });

  it('summary: new, changed, context and config need their file; removed does not', () => {
    const s = map(
      'summary',
      { status: 'new', path: 'gone.ts' },
      { status: 'changed', path: 'gone.ts' },
      { status: 'context', path: 'gone.ts' },
      { status: 'config', path: 'gone.ts' },
      { status: 'removed', path: 'gone.ts' },
    );
    expect(shorts(s)).toEqual(['+node0 file missing', '~node1 file missing', '·node2 file missing', '◆node3 file missing']);
  });

  it('plan: a new file need not exist yet; every other status needs it', () => {
    const s = map('plan', { status: 'new', path: 'gone.ts' }, { status: 'changed', path: 'gone.ts' }, { status: 'removed', path: 'gone.ts' });
    expect(shorts(s)).toEqual(['~node1 file missing', '-node2 file missing']);
  });

  it('a folder counts as existing', () => {
    expect(shorts(map('summary', { status: 'context', path: 'src' }))).toEqual([]);
  });

  it('suggests the likely path', () => {
    const r = checkMapNodes(map('summary', { status: 'context', path: 'a.ts' }), repo);
    expect(r.mismatches[0]!.detail).toBe('a.ts does not exist; did you mean src/a.ts');
  });

  it('a path outside the repo is a mismatch, not read', () => {
    writeFileSync(join(base, 'secret.txt'), 'TOPSECRET\n');
    const r = checkMapNodes(map('summary', { status: 'context', path: '../secret.txt', match: 'TOPSECRET' }), repo);
    expect(r.mismatches[0]).toMatchObject({ short: 'file unreadable', detail: '../secret.txt is outside the repo' });
    expect(r.matches.size).toBe(0);
  });

  it('a cwd-relative path resolves from the cwd', () => {
    const r = checkMapNodes(map('summary', { status: 'context', path: 'a.ts', match: 'const a' }), repo, { cwd: join(repo, 'src') });
    expect(r.mismatches).toEqual([]);
    expect(r.matches.get('n0')!.source).toBe('src/a.ts:1');
  });

  it('with at, reads the commit, not the working tree', () => {
    const sha = git('rev-parse', 'HEAD').trim();
    writeFileSync(join(repo, 'src/new.ts'), 'x\n');
    const s = map('summary', { status: 'context', path: 'src/new.ts' }, { status: 'context', path: 'src/a.ts' });
    expect(checkMapNodes(s, repo, { at: sha }).mismatches.map((m) => m.detail)).toEqual([`src/new.ts does not exist at ${sha.slice(0, 12)}`]);
  });
});

describe('checkMapNodes: diff', () => {
  it('summary: new, changed and removed need their file in the diff; context and config do not', () => {
    const s = map(
      'summary',
      { status: 'new', path: 'src/a.ts' },
      { status: 'changed', path: 'src/a.ts' },
      { status: 'removed', path: 'src/a.ts' },
      { status: 'context', path: 'src/a.ts' },
      { status: 'config', path: 'src/a.ts' },
    );
    expect(shorts(s, ['other.ts'])).toEqual(['+node0 not in diff', '~node1 not in diff', '-node2 not in diff']);
    expect(shorts(s, ['src/a.ts'])).toEqual([]);
  });

  it('is skipped without a diff and for plans', () => {
    expect(shorts(map('summary', { status: 'changed', path: 'src/a.ts' }))).toEqual([]);
    expect(shorts(map('plan', { status: 'changed', path: 'src/a.ts' }), [])).toEqual([]);
  });

  it('a folder is in the diff when a file under it is', () => {
    expect(shorts(map('summary', { status: 'changed', path: 'src' }), ['src/a.ts'])).toEqual([]);
  });

  it('normalises ./ paths before comparing', () => {
    expect(shorts(map('summary', { status: 'changed', path: './src/a.ts' }), ['src/a.ts'])).toEqual([]);
  });

  it('explains the mismatch in full for the HTML', () => {
    const r = checkMapNodes(map('summary', { status: 'changed', path: 'src/a.ts' }), repo, { diff: diffOf([]) });
    expect(r.mismatches[0]!.detail).toBe("marked changed, but src/a.ts isn't in the diff");
  });
});

describe('checkMapNodes: match', () => {
  it('stores the matched line', () => {
    const r = checkMapNodes(map('summary', { status: 'changed', path: 'src/a.ts', match: 'const b2' }), repo);
    expect(r.mismatches).toEqual([]);
    expect(r.matches.get('n0')).toEqual({ source: 'src/a.ts:3', startLine: 3, lines: ['export const b2 = 2;'] });
  });

  it('reports a match that is missing or on several lines', () => {
    const s = map('summary', { status: 'changed', path: 'src/a.ts', match: 'nope' }, { status: 'changed', path: 'src/a.ts', match: 'const b' });
    expect(shorts(s)).toEqual(['~node0 match not found', '~node1 match on several lines']);
  });

  it('is not checked when the file need not exist', () => {
    expect(shorts(map('summary', { status: 'removed', path: 'src/a.ts', match: 'nope' }))).toEqual([]);
    expect(shorts(map('plan', { status: 'new', path: 'src/a.ts', match: 'nope' }))).toEqual([]);
  });

  it('one mismatch per node: a missing file is not also a bad match', () => {
    expect(shorts(map('summary', { status: 'changed', path: 'gone.ts', match: 'x' }), ['other.ts'])).toEqual(['~node0 file missing']);
  });

  it('the schema needs path with match', () => {
    const r = validateSpec({ title: 't', kind: 'summary', edges: [], nodes: [{ id: 'a', label: 'a', kind: 'table', status: 'new', layer: 'l', match: 'x' }] });
    expect(r.ok ? [] : r.errors).toEqual(['nodes[0].match: needs path set to the file the line is in']);
  });
});

describe('checkFlowDiff', () => {
  const flow = (kind: FlowSpec['kind'], status: 'new' | 'existing'): FlowSpec => ({
    diagram: 'flow',
    kind,
    title: 't',
    start: 's',
    steps: [{ id: 's', label: 'a step', type: 'end', status, source: 'src/a.ts:1' }],
    links: [],
  });
  const snippets = { steps: new Map([['s', { source: 'src/a.ts:1', startLine: 1, lines: ['x'] }]]), links: {} };

  it("flags a new or changed step whose file isn't in the diff", () => {
    const r = checkFlowDiff(flow('summary', 'new'), snippets, 1, repo, diffOf(['b.ts']));
    expect(r).toEqual({
      checked: 1,
      unit: 'anchor',
      mismatches: [{ id: 's', label: '+a step', short: 'not in diff', detail: "marked new, but src/a.ts isn't in the diff" }],
    });
  });

  it('passes when the file is in the diff, and skips existing steps, plans and no diff', () => {
    expect(checkFlowDiff(flow('summary', 'new'), snippets, 1, repo, diffOf(['src/a.ts'])).mismatches).toEqual([]);
    expect(checkFlowDiff(flow('summary', 'existing'), snippets, 1, repo, diffOf([])).mismatches).toEqual([]);
    expect(checkFlowDiff(flow('summary', 'new'), snippets, 1, repo).mismatches).toEqual([]);
  });
});

describe('check lines', () => {
  const m = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `~n${i}`, short: 'not in diff', detail: '' }));

  it('footer tag: plain count when all match, passed of checked otherwise, nothing when nothing was checked', () => {
    expect(checkTag({ checked: 10, mismatches: [], unit: 'node' })).toBe(' · ✓ 10 checked');
    expect(checkTag({ checked: 10, mismatches: m(2), unit: 'node' })).toBe(' · ✓ 8 of 10 checked');
    expect(checkTag({ checked: 1, mismatches: [], unit: 'anchor' })).toBe(' · ✓ 1 anchor checked');
    expect(checkTag({ checked: 6, mismatches: m(1), unit: 'anchor' })).toBe(' · ✓ 5 of 6 anchors checked');
    expect(checkTag({ checked: 0, mismatches: [], unit: 'node' })).toBe('');
  });

  it('alert line: only on a mismatch, at most 5 named, wrapped to the width', () => {
    expect(alertLine({ checked: 3, mismatches: [], unit: 'node' }, 80)).toBe('');
    expect(alertLine({ checked: 3, mismatches: m(1), unit: 'node' }, 80)).toBe("✗ 1 claim doesn't match the code: ~n0 not in diff");
    const many = alertLine({ checked: 9, mismatches: m(7), unit: 'node' }, 80);
    expect(many.startsWith("✗ 7 claims don't match the code: ~n0 not in diff")).toBe(true);
    expect(many).toContain('+2 more');
    expect(many).not.toContain('~n5');
    expect(many.split('\n').every((l) => [...l].length <= 80)).toBe(true);
    const narrow = alertLine({ checked: 9, mismatches: m(2), unit: 'node' }, 60);
    expect(narrow).toBe("✗ 2 claims don't match the code:\n  ~n0 not in diff · ~n1 not in diff");
  });

  it('HTML headline', () => {
    expect(checkHeadline({ checked: 10, mismatches: [], unit: 'node' })).toBe('✓ 10 nodes checked against the code');
    expect(checkHeadline({ checked: 10, mismatches: m(1), unit: 'node' })).toBe("✗ 1 of 10 nodes doesn't match the code");
    expect(checkHeadline({ checked: 0, mismatches: [], unit: 'node' })).toBe('');
  });
});

describe('review findings', () => {
  it('a removed node given relative to the cwd matches its deleted file in the diff', () => {
    const s = map('summary', { status: 'removed', path: 'old.ts' });
    expect(checkMapNodes(s, repo, { cwd: join(repo, 'src'), diff: diffOf(['src/old.ts']) }).mismatches).toEqual([]);
  });

  it('the repo root as a folder node exists and is in a non-empty diff', () => {
    const sha = git('rev-parse', 'HEAD').trim();
    expect(shorts(map('summary', { status: 'changed', path: '.' }), ['src/a.ts'])).toEqual([]);
    expect(checkMapNodes(map('summary', { status: 'context', path: '.' }), repo, { at: sha }).mismatches).toEqual([]);
  });

  it('a narrow terminal keeps the check result and wraps the alert under a short indent', () => {
    const c = { checked: 1, mismatches: [{ id: 'n', label: '~OrderStatus', short: 'not in diff', detail: '' }], unit: 'node' as const };
    const alert = alertLine(c, 20);
    expect(alert.split('\n').every((l) => [...l].length <= 20)).toBe(true);
    expect(alert).toContain('~OrderStatus');
  });
});

describe('infrastructure nodes', () => {
  it('resources and module calls anchor on their block line, so a change to the call file alone checks clean', () => {
    mkdirSync(join(repo, 'infra/modules/vpc'), { recursive: true });
    writeFileSync(join(repo, 'infra/main.tf'), 'resource "aws_s3_bucket" "logs" {\n  bucket = "logs"\n}\n\nmodule "vpc" {\n  source = "./modules/vpc"\n}\n');
    writeFileSync(join(repo, 'infra/modules/vpc/main.tf'), 'resource "aws_vpc" "main" {}\n');
    const v = validateSpec({
      title: 'Logs bucket', kind: 'summary',
      nodes: [
        { id: 'logs', label: 'aws_s3_bucket.logs', kind: 'other', status: 'new', layer: 'storage', path: 'infra/main.tf', match: 'resource "aws_s3_bucket" "logs"' },
        { id: 'vpc', label: 'module.vpc', kind: 'other', status: 'changed', layer: 'network', path: 'infra/main.tf', match: 'module "vpc"' },
        { id: 'region', label: 'var.region', kind: 'config', status: 'config', layer: 'config' },
      ],
      edges: [{ from: 'logs', to: 'region', label: 'region', kind: 'reads' }],
    });
    if (!v.ok) throw new Error(v.errors.join('\n'));
    const r = checkMapNodes(v.spec as Spec, repo, { diff: diffOf(['infra/main.tf']) });
    expect(r.mismatches).toEqual([]);
    expect(r.matches.get('logs')?.startLine).toBe(1);
    expect(r.matches.get('vpc')?.startLine).toBe(5);
    // A local module's own code is a folder node, in the diff only when a file under it changed.
    const internals = map('summary', { status: 'changed', path: 'infra/modules/vpc' });
    expect(shorts(internals, ['infra/modules/vpc/main.tf'])).toEqual([]);
    expect(shorts(internals, ['infra/main.tf'])).toEqual(['~node0 not in diff']);
  });
});

describe('countLines', () => {
  const ok = { checked: 1, mismatches: [], unit: 'node' as const };
  it('keeps the tag on the count line when it fits, else on its own line', () => {
    expect(countLines('1 nodes · 0 new', ok, 80)).toBe('1 nodes · 0 new · ✓ 1 checked');
    expect(countLines('1 nodes · 0 new · 1 changed · 0 config', ok, 40)).toBe('1 nodes · 0 new · 1 changed · 0 config\n✓ 1 checked');
    expect(countLines('1 nodes · 0 new', undefined, 10)).toBe('1 nodes ·…');
  });

  it('splits the tag into its parts rather than cutting "diff not checked"', () => {
    const unchecked = { ...ok, diffUnchecked: true };
    expect(countLines('1 nodes · 0 new', unchecked, 20)).toBe('1 nodes · 0 new\n✓ 1 checked\ndiff not checked');
    expect(countLines('1 nodes · 0 new · 1 changed', unchecked, 40)).toBe('1 nodes · 0 new · 1 changed\n✓ 1 checked · diff not checked');
  });
});

describe('uncovered files', () => {
  it('from a subfolder, a node found at the root covers only the root file', () => {
    writeFileSync(join(repo, 'README.md'), 'x\n');
    mkdirSync(join(repo, 'packages/api'), { recursive: true });
    writeFileSync(join(repo, 'packages/api/README.md'), 'y\n');
    const s = map('summary', { status: 'changed', path: 'README.md' });
    const r = checkMapNodes(s, repo, { cwd: join(repo, 'packages/api'), diff: diffOf(['README.md', 'packages/api/README.md']) });
    expect(r.uncovered).toEqual(['packages/api/README.md']);
  });
});
