import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkFlowDiff, checkMapNodes, diffOf } from '../../src/render/check.js';
import { alertLine, checkHeadline, checkHeadlineParts, checkTag, countLines } from '../../src/render/terminal/check-lines.js';
import type { ChangeStatus } from '../../src/rules/git-files.js';
import type { FlowSpec } from '../../src/spec/flow.js';
import { validateSpec, type Spec, type SpecNode } from '../../src/spec/schema.js';
import { repoFromTemplate } from '../helpers/sandbox.js';

let base: string;
let repo: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString();

function seed(dir: string) {
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/a.ts'), 'export const a = 1;\nexport const b = 2;\nexport const b2 = 2;\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'codechart-mapcheck-'));
  repo = join(base, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  repoFromTemplate(repo, seed);
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

const statusDiff = (changes: [string, ChangeStatus][]) =>
  diffOf(changes.map(([path]) => path), changes.map(([path, status]) => ({ path, status })));

describe('checkMapNodes: file exists', () => {
  it('counts only nodes with a path', () => {
    const r = checkMapNodes(map('summary', { status: 'changed', path: 'src/a.ts' }, { status: 'context', kind: 'table' }), repo);
    expect(r).toMatchObject({ checked: 1, mismatches: [], notCheckable: 1, unit: 'node' });
  });

  it('says how many nodes are not checkable, only when some are', () => {
    const two = checkMapNodes(map('summary', { status: 'context', path: 'src/a.ts' }, { status: 'config', kind: 'table' }, { status: 'config', kind: 'service' }), repo);
    expect(two.notCheckable).toBe(2);
    expect(checkTag(two)).toBe(' · ✓ 1 checked · 2 not checkable');
    const none = checkMapNodes(map('summary', { status: 'context', path: 'src/a.ts' }), repo);
    expect(none.notCheckable).toBeUndefined();
    expect(checkTag(none)).toBe(' · ✓ 1 checked');
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
    expect(shorts(s)).toEqual(['+node0 file missing', '~node1 file missing', 'node2 file missing', '◆node3 file missing']);
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
    expect(r.mismatches[0]).toMatchObject({ short: 'outside the repo', detail: '../secret.txt is outside the repo' });
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

describe('checkMapNodes: a folder with a match', () => {
  it('is a file unreadable mismatch', () => {
    const r = checkMapNodes(map('summary', { status: 'changed', path: 'src', match: 'export const a' }), repo, {});
    expect(r.mismatches.map((m) => m.short)).toEqual(['file unreadable']);
  });
});

describe('checkMapNodes: symlinks', () => {
  it.skipIf(process.platform === 'win32')('a node path that is a symlink out of the repo is a mismatch', () => {
    const outside = join(base, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(repo, 'link'));
    const r = checkMapNodes(map('summary', { status: 'changed', path: 'link' }), repo, {});
    expect(r.mismatches).toHaveLength(1);
    expect(r.mismatches[0]!.detail).toContain('outside the repo');
  });
});

describe('checkMapNodes: git status', () => {
  const check = (status: SpecNode['status'], changes: [string, ChangeStatus][]) =>
    checkMapNodes(map('summary', { status, path: 'src/a.ts' }), repo, { diff: statusDiff(changes) }).mismatches;

  it('new needs an added file: modified, deleted and renamed are mismatches', () => {
    expect(check('new', [['src/a.ts', 'A']])).toEqual([]);
    expect(check('new', [['src/a.ts', 'M']])[0]).toMatchObject({ short: 'marked new, but modified in git', detail: 'marked new, but src/a.ts is modified in git' });
    expect(check('new', [['src/a.ts', 'D']])[0]!.short).toBe('marked new, but deleted in git');
    expect(check('new', [['src/a.ts', 'R']])[0]!.short).toBe('marked new, but renamed in git');
  });

  it('removed needs a deleted file; changed needs modified or renamed', () => {
    expect(check('removed', [['src/a.ts', 'D']])).toEqual([]);
    expect(check('removed', [['src/a.ts', 'M']])[0]!.short).toBe('marked removed, but modified in git');
    expect(check('changed', [['src/a.ts', 'A']])[0]!.short).toBe('marked changed, but added in git');
    expect(check('changed', [['src/a.ts', 'M']])).toEqual([]);
    expect(check('changed', [['src/a.ts', 'R']])).toEqual([]);
  });

  it('a plain file list has no statuses, so it stays a membership check', () => {
    expect(shorts(map('summary', { status: 'new', path: 'src/a.ts' }), ['src/a.ts'])).toEqual([]);
  });

  it('a folder takes the statuses of its files', () => {
    mkdirSync(join(repo, 'src/pkg'), { recursive: true });
    writeFileSync(join(repo, 'src/pkg/x.ts'), 'x\n');
    const s = map('summary', { status: 'changed', path: 'src/pkg' });
    expect(checkMapNodes(s, repo, { diff: statusDiff([['src/pkg/x.ts', 'M']]) }).mismatches).toEqual([]);
    expect(checkMapNodes(s, repo, { diff: statusDiff([['src/pkg/x.ts', 'A']]) }).mismatches[0]!.short).toBe('marked changed, but added in git');
  });

  it('a folder of deleted files reads as removed; added and deleted together read as added', () => {
    const removed = map('summary', { status: 'removed', path: 'src/pkg' });
    expect(checkMapNodes(removed, repo, { diff: statusDiff([['src/pkg/x.ts', 'D'], ['src/pkg/y.ts', 'D']]) }).mismatches).toEqual([]);
    mkdirSync(join(repo, 'src/pkg'), { recursive: true });
    const changed = map('summary', { status: 'changed', path: 'src/pkg' });
    expect(checkMapNodes(changed, repo, { diff: statusDiff([['src/pkg/x.ts', 'A'], ['src/pkg/y.ts', 'D']]) }).mismatches[0]!.short).toBe('marked changed, but added in git');
  });
});

describe('checkMapNodes: field warnings', () => {
  it('matches loosely and warns on a missing field, skipping removed ones', () => {
    writeFileSync(join(repo, 'src/fields.ts'), 'export const totalAmount = 1;\n');
    const s = map('summary', {
      status: 'changed',
      path: 'src/fields.ts',
      fields: [{ name: 'total_amount' }, { name: 'discount_code' }, { name: 'old_name', change: 'removed' }],
      fieldsComplete: false,
    });
    const r = checkMapNodes(s, repo);
    expect(r.mismatches).toEqual([]);
    expect(r.warnings).toEqual([{ id: 'n0', label: '~node0', short: 'field discount_code not found', detail: "src/fields.ts doesn't mention the field discount_code" }]);
  });

  it('matches a dotted field as a nested block, parts in order', () => {
    mkdirSync(join(repo, 'infra'));
    writeFileSync(join(repo, 'infra/alb.tf'), 'resource "aws_lb" "api" {\n  access_logs {\n    bucket = x\n  }\n}\n');
    const s = map('summary', { status: 'changed', path: 'infra/alb.tf', fields: [{ name: 'access_logs.bucket' }, { name: 'access_logs.missing' }], fieldsComplete: false });
    expect(checkMapNodes(s, repo).warnings!.map((w) => w.short)).toEqual(['field access_logs.missing not found']);
  });

  it('warns only in a summary, and skips a file too big to read', () => {
    writeFileSync(join(repo, 'src/fields.ts'), 'export const totalAmount = 1;\n');
    const node = { status: 'changed' as const, path: 'src/fields.ts', fields: [{ name: 'missing' }], fieldsComplete: false };
    expect(checkMapNodes(map('plan', node), repo).warnings).toBeUndefined();
    writeFileSync(join(repo, 'src/huge.ts'), 'x'.repeat(5 * 1024 * 1024 + 1));
    expect(checkMapNodes(map('summary', { ...node, path: 'src/huge.ts' }), repo).warnings).toBeUndefined();
  });
});

describe('checkMapNodes: arrow warnings', () => {
  it('warns when the from file does not mention the to file, loosely', () => {
    writeFileSync(join(repo, 'src/order.ts'), 'import { totalAmount } from "./total_amount";\n');
    writeFileSync(join(repo, 'src/total_amount.ts'), 'export const totalAmount = 1;\n');
    writeFileSync(join(repo, 'src/other.ts'), 'export const other = 1;\n');
    const s = map('summary', { status: 'context', path: 'src/order.ts' }, { status: 'context', path: 'src/total_amount.ts' }, { status: 'context', path: 'src/other.ts' });
    s.edges = [
      { from: 'n0', to: 'n1', kind: 'imports' },
      { from: 'n0', to: 'n2', kind: 'imports' },
    ];
    const r = checkMapNodes(s, repo);
    expect(r.mismatches).toEqual([]);
    expect(r.warnings).toEqual([{ id: 'edge-1', label: 'node0 → node2', short: 'no mention of other or node2', detail: "src/order.ts doesn't mention other or node2 (the box in src/other.ts)" }]);
  });

  it('skips an arrow whose ends have no path', () => {
    const s = map('summary', { status: 'context', path: 'src/order.ts' }, { status: 'context', kind: 'service' });
    s.edges = [{ from: 'n0', to: 'n1', kind: 'calls' }];
    expect(checkMapNodes(s, repo).warnings).toBeUndefined();
  });
});

describe('checkMapNodes: arrow mentions', () => {
  const warns = (files: Record<string, string>, from: Partial<SpecNode>, to: Partial<SpecNode>) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(repo, path, '..'), { recursive: true });
      writeFileSync(join(repo, path), text);
    }
    const s = map('summary', { ...from, status: 'context' }, { ...to, status: 'context' });
    s.edges = [{ from: 'n0', to: 'n1', kind: 'reads' }];
    return (checkMapNodes(s, repo).warnings ?? []).map((w) => w.short);
  };

  it.each([
    ['a module address', 'subnets = module.vpc.public_subnets\n', 'module.vpc', 'main.tf'],
    ['a variable address', 'days = var.log_retention_days\n', 'var.log_retention_days', 'variables.tf'],
  ])('accepts %s for the target label', (_, text, label, file) => {
    expect(warns({ 'infra/alb.tf': text }, { path: 'infra/alb.tf' }, { label, path: `infra/${file}` })).toEqual([]);
  });

  it('accepts a Go package-qualified call for a target in another file name', () => {
    expect(warns({ 'handlers/orders.go': 'o, err := store.FindOrder(id)\n' }, { path: 'handlers/orders.go' }, { label: 'store.FindOrder', path: 'store/postgres.go' })).toEqual([]);
  });

  it('accepts an import of the folder for an index file', () => {
    expect(warns({ 'src/pay.ts': "import { charge } from './billing';\n" }, { path: 'src/pay.ts' }, { label: 'charge', path: 'src/billing/index.ts' })).toEqual([]);
  });

  it('two boxes in one file: the file name proves nothing, the label does', () => {
    const files = { 'src/models.ts': 'export class Order {}\nexport class Customer { o: Order }\n' };
    expect(warns(files, { label: 'Customer', path: 'src/models.ts' }, { label: 'Order', path: 'src/models.ts' })).toEqual([]);
    expect(warns(files, { label: 'Customer', path: 'src/models.ts' }, { label: 'Invoice', path: 'src/models.ts' })).toEqual(['no mention of Invoice']);
  });

  it('takes the last word of a "Kind name" label', () => {
    expect(warns({ 'k8s/service.yaml': 'selector:\n  app: api\n' }, { label: 'Service api', path: 'k8s/service.yaml' }, { label: 'Deployment api', path: 'k8s/deployment.yaml' })).toEqual([]);
  });

  it('still warns when the source never mentions the target', () => {
    expect(warns({ 'api/refunds.py': 'def refund(): pass\n' }, { path: 'api/refunds.py' }, { label: 'mailer', path: 'lib/mailer.py' })).toEqual(['no mention of mailer']);
  });

  it('ignores a label shorter than 3 characters', () => {
    expect(warns({ 'src/a.ts': 'const valid = identity(1);\n' }, { path: 'src/a.ts' }, { label: 'id', path: 'src/schema.ts' })).toEqual(['no mention of schema']);
  });
});

describe('checkMapNodes: edge cases', () => {
  it('an empty diff flags every claimed change', () => {
    expect(shorts(map('summary', { status: 'changed', path: 'src/a.ts' }), [])).toEqual(['~node0 not in diff']);
  });

  it('keeps a path with spaces whole', () => {
    writeFileSync(join(repo, 'src/my file.ts'), 'x\n');
    const s = map('summary', { status: 'new', path: 'src/my file.ts' });
    expect(checkMapNodes(s, repo, { diff: statusDiff([['src/my file.ts', 'A']]) }).mismatches).toEqual([]);
  });

  it('a Windows-style path to a missing file is a clean mismatch', () => {
    const r = checkMapNodes(map('summary', { status: 'changed', path: 'nope\\a.ts' }), repo, { diff: statusDiff([['nope/a.ts', 'M']]) });
    expect(r.mismatches[0]!.short).toBe('file missing');
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

  it('warnings: one softer line under the ✗ lines, and counted in the headline', () => {
    const w = [{ id: 'e', label: 'a → b', short: 'no mention of b', detail: '' }];
    const c = { checked: 3, mismatches: m(1), warnings: w, unit: 'node' as const };
    expect(alertLine(c, 80)).toBe("✗ 1 claim doesn't match the code: ~n0 not in diff\n⚠ 1 warning: a → b no mention of b");
    expect(checkHeadline({ checked: 3, mismatches: [], warnings: w, unit: 'node' })).toBe('✓ 3 nodes checked against the code · ⚠ 1 warning');
  });

  it('flattens control characters in a warning label and short, so they cannot drive the terminal', () => {
    writeFileSync(join(repo, 'src/evil.ts'), 'export const x = 1;\n');
    const spec = map('summary', { status: 'context', path: 'src/evil.ts', fields: [{ name: 'bad\u001b[2Jname' }], fieldsComplete: false });
    const r = checkMapNodes(spec, repo);
    const line = alertLine(r, 200);
    expect(line).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
    expect(line).toContain('field bad');
    expect(line).toContain('name not found');
  });

  it('HTML headline', () => {
    expect(checkHeadline({ checked: 10, mismatches: [], unit: 'node' })).toBe('✓ 10 nodes checked against the code');
    expect(checkHeadline({ checked: 10, mismatches: m(1), unit: 'node' })).toBe("✗ 1 of 10 nodes doesn't match the code");
    expect(checkHeadline({ checked: 0, mismatches: [], unit: 'node' })).toBe('');
  });

  it('headline parts keep their own tone: the ✓ stays green beside a red ✗', () => {
    const c = { checked: 15, mismatches: [], uncovered: ['src/x.ts'], unit: 'node' as const };
    expect(checkHeadlineParts(c)).toEqual([
      { text: '✓ 15 nodes checked against the code', tone: 'ok' },
      { text: '✗ 1 changed file not on map', tone: 'bad' },
    ]);
    const warning = { checked: 3, mismatches: [], warnings: [m(1)[0]!], diffUnchecked: true, unit: 'node' as const };
    expect(checkHeadlineParts(warning).map((p) => p.tone)).toEqual(['ok', 'warn', 'muted']);
    expect(checkHeadlineParts(undefined)).toEqual([]);
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
