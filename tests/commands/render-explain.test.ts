import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { explain, EXPLAIN_FILES } from '../fixtures/explain.js';
import { git, makeSandbox, removeSandbox, repoFromTemplate, runCli, type Sandbox } from '../helpers/sandbox.js';

let sb: Sandbox;

function seed(dir: string) {
  for (const [file, text] of Object.entries(EXPLAIN_FILES)) {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
}

beforeEach(() => {
  sb = makeSandbox('explain', { htmlOut: true });
  repoFromTemplate(sb.repo, seed);
});
afterEach(() => removeSandbox(sb.tmp));

let tick = 0;
const run = (spec: unknown, ...args: string[]) => {
  process.exitCode = undefined;
  const now = new Date(2026, 10, 10, 10, 0, tick++);
  writeFileSync(join(sb.tmp, 'explain.json'), JSON.stringify(spec));
  return runCli({ cwd: sb.repo, home: sb.home, now: () => now, isTTY: false }, ['render', join(sb.tmp, 'explain.json'), ...args]);
};

const outDir = (): string => join(sb.out, readdirSync(sb.out)[0]!);
const outFiles = (): string[] => (existsSync(sb.out) ? readdirSync(outDir()) : []);
const html = (): string => readFileSync(join(outDir(), outFiles().find((n) => n.endsWith('.html'))!), 'utf8');

describe('render: explain map', () => {
  it('--md prints boxes without change wording, the explain key and a checked count', async () => {
    const r = await run(explain(), '--md', '--output', 'cli');
    expect(r.err).toBe('');
    expect(r.code).toBeUndefined();
    expect(r.out).toBe(
      [
        '**Map** _(key: ○ outside · unmarked = in this area)_',
        '```text',
        'api',
        '  endpoint POST /invoices ─create_invoice─▶ service BillingService',
        '',
        'billing',
        '  service BillingService ─receipt─▶ service EmailService',
        '                         ─charge──▶ Stripe API',
        '',
        'other areas',
        '○ service EmailService',
        '○ Stripe API',
        '',
        '4 boxes · 2 outside · ✓ 3 checked',
        'gaps: refund job: not read',
        '```',
        '',
        '',
      ].join('\n'),
    );
  });

  it('writes the page and a review file of kind map, and saves no plan', async () => {
    const r = await run(explain(), '--output', 'web');
    expect(r.err).toBe('');
    expect(r.out).toMatch(/full map → file:\/\/.*\.html\n$/);
    expect(outFiles().filter((n) => n.endsWith('.html'))).toHaveLength(1);
    const review = JSON.parse(readFileSync(join(outDir(), outFiles().find((n) => n.endsWith('.review.json'))!), 'utf8'));
    expect(review.change).toMatchObject({ kind: 'map', title: 'How billing works' });
    expect(review.change.range).toBeUndefined();
    expect(review.change.slug).toBe('how-billing-works.explain');
    expect(outFiles().find((n) => n.endsWith('.html'))).toMatch(/^\d{8}-\d{6}-how-billing-works\.explain\.html$/);
    expect(review.nodes.map((n: { id: string }) => n.id)).toEqual(['api', 'billing', 'email', 'stripe']);
    expect(existsSync(join(sb.out, 'plans'))).toBe(false);
    expect(html()).toContain('status-outside');
  });

  it('accepts an outside box without a path, and flags a box whose match is not in its file', async () => {
    const spec = explain();
    spec.nodes[1].match = 'class Nope';
    const r = await run(spec, '--md', '--output', 'cli');
    expect(r.out).toContain("✗ 1 claim doesn't match the code: BillingService match not found");
    expect(r.out).toContain('✓ 2 of 3 checked');
  });

  it('flags an existing box whose file is missing', async () => {
    const spec = explain();
    spec.nodes[0].path = 'app/gone.ts';
    delete spec.nodes[0].match;
    const r = await run(spec, '--md', '--output', 'cli');
    expect(r.out).toContain('POST /invoices file missing');
  });

  it('flags an outside box whose path is missing', async () => {
    const spec = explain();
    spec.nodes[2].path = 'app/gone.ts';
    const r = await run(spec, '--md', '--output', 'cli');
    expect(r.out).toContain('EmailService file missing');
  });

  it('says boxes, not nodes, in the page header note and the review document', async () => {
    await run(explain(), '--output', 'web');
    expect(html()).toContain('✓ 3 boxes checked against the code');
    expect(html()).not.toContain('nodes checked');
    const r = await runCli({ cwd: sb.repo, home: sb.home, isTTY: false }, ['review', '--print']);
    expect(r.out).toContain('# On the map (you can note on any box):\n## POST /invoices — app/api.ts  [api]\n');
    expect(r.out).not.toContain('Unchanged');
  });

  it('--strict exits 1 on a mismatch', async () => {
    const spec = explain();
    spec.nodes[1].match = 'class Nope';
    const r = await run(spec, '--strict', '--output', 'cli');
    expect(r.code).toBe(1);
  });

  it('rejects an existing box without a path', async () => {
    const spec = explain();
    delete spec.nodes[0].path;
    delete spec.nodes[0].match;
    const r = await run(spec);
    expect(r.code).toBe(1);
    expect(r.err).toContain('nodes[0].path: required for "existing"');
    expect(outFiles()).toEqual([]);
  });

  it.each([['--git'], ['--since', 'HEAD'], ['--commit', 'HEAD'], ['--since', 'HEAD', '--head', 'HEAD']])('refuses the diff flags %s', async (...flags) => {
    const r = await run(explain(), ...flags);
    expect(r.code).toBe(1);
    expect(r.err).toContain('do not apply to an explain map');
    expect(outFiles()).toEqual([]);
  });

  it('refuses --pr', async () => {
    const r = await run(explain(), '--pr');
    expect(r.code).toBe(1);
    expect(r.err).toContain('explain maps are not for PR descriptions');
  });

  it('--at reads the anchors from another revision', async () => {
    writeFileSync(join(sb.repo, 'app/billing.ts'), 'export class Other {}\n');
    git(sb.repo, 'commit', '-q', '-am', 'rename');
    const now = await run(explain(), '--md', '--output', 'cli');
    expect(now.out).toContain('match not found');
    const before = await run(explain(), '--md', '--output', 'cli', '--at', 'HEAD~1');
    expect(before.out).toContain('✓ 3 checked');
    expect(before.out).not.toContain('✗');
  });

  it('a change map with the same title is a different file: neither replaces the other', async () => {
    const summary = { title: 'How billing works', kind: 'summary', nodes: [{ id: 'a', label: 'a', kind: 'file', status: 'changed', layer: 'l', path: 'app/api.ts' }], edges: [] };
    await run(summary, '--output', 'web');
    await run(explain(), '--output', 'web');
    expect(outFiles().filter((n) => n.endsWith('.html'))).toHaveLength(2);
  });

  it('a second render of the same title replaces the first page', async () => {
    await run(explain(), '--output', 'web');
    await run(explain(), '--output', 'web');
    expect(outFiles().filter((n) => n.endsWith('.html'))).toHaveLength(1);
    expect(outFiles().filter((n) => n.endsWith('.review.json'))).toHaveLength(1);
  });
});
