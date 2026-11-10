import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXPLAIN_FILES, explain, withFlows } from '../fixtures/explain.js';
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
  sb = makeSandbox('explain-flows', { htmlOut: true });
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
const flat = (s: string): string => s.replace(/\s+/g, ' ');
const html = (): string => readFileSync(join(outDir(), outFiles().find((n) => n.endsWith('.html'))!), 'utf8');

describe('render: explain map with flows', () => {
  it('counts boxes and steps in the page header and says which flows the page has, after the map block', async () => {
    const r = await run(withFlows(), '--md');
    expect(r.err).toBe('');
    expect(html()).toContain('✓ 3 boxes and 6 steps checked against the code');
    expect(r.out).toContain('4 boxes · 2 outside · ✓ 9 checked');
    expect(r.out).toMatch(/\[Open full map\]\(file:\/\/[^)]*\.html\)\n\nFlows on the page: Create an invoice · Send the receipt\n\n$/);
  });

  it('prints the same flows line without --md, below the link to the page', async () => {
    const r = await run(withFlows(), '--output', 'both');
    expect(r.out).toMatch(/full map → file:\/\/.*\.html\nFlows on the page: Create an invoice · Send the receipt\n$/);
  });

  it('says the same after the alert when only the page is drawn', async () => {
    const r = await run(withFlows(), '--output', 'web');
    expect(r.out).toMatch(/full map → file:\/\/.*\.html\nFlows on the page: Create an invoice · Send the receipt\n$/);
  });

  it('draws no flows line and no tab row for a map without flows', async () => {
    const r = await run(explain(), '--md', '--output', 'both');
    expect(r.out).not.toContain('Flows on the page');
    expect(html()).not.toContain('id="view-tabs"');
    expect(html()).not.toContain('class="view"');
  });

  it('draws the tab row, one canvas per view and a panel per box and step', async () => {
    await run(withFlows(), '--output', 'web');
    const page = html();
    expect(page).toContain('Flows (2)');
    expect(page.match(/<section class="view/g)).toHaveLength(3);
    expect(page).toContain('data-for="flow:create/charge"');
  });

  it('a step whose anchor is not in its file is flagged in the terminal and on the page, and the flow still draws', async () => {
    const spec = withFlows();
    spec.flows[0].steps[3].match = 'class Nope';
    const r = await run(spec, '--md');
    expect(r.err).toBe('');
    expect(flat(r.out)).toContain("✗ 1 claim doesn't match the code: Create an invoice: Charge the card match not found");
    expect(r.out).toContain('✓ 8 of 9 checked');
    expect(html()).toContain('✗ 1 of 9 boxes and steps doesn&#39;t match the code');
    expect(html()).toContain('&quot;class Nope&quot; not found in app/billing.ts');
    expect(html()).toContain('data-id="flow:create/charge"');
  });

  it('a branch whose anchor is missing is flagged on the step it leaves', async () => {
    const spec = withFlows();
    delete spec.flows[0].links[1].match;
    spec.flows[0].links[1].source = 'app/gone.ts:3';
    const r = await run(spec, '--md');
    expect(flat(r.out)).toContain('Create an invoice: Is the total zero? file missing');
  });

  it('a step anchored to a line past the end of its file is flagged with a reason on the page', async () => {
    const spec = withFlows();
    delete spec.flows[1].steps[1].match;
    spec.flows[1].steps[1].source = 'app/email.ts:40';
    const r = await run(spec, '--md');
    expect(flat(r.out)).toContain('Send the receipt: Email it line not found');
    expect(html()).toContain("pointed this step at a line that isn&#39;t in the file");
  });

  it('--at reads the flows anchors from another revision, and --strict exits 1 on a step mismatch', async () => {
    writeFileSync(join(sb.repo, 'app/email.ts'), 'export class Other {}\n');
    git(sb.repo, 'commit', '-q', '-am', 'rename');
    const now = await run(withFlows(), '--md', '--strict');
    expect(flat(now.out)).toContain('Send the receipt: Email it match not found');
    expect(now.code).toBe(1);
    const before = await run(withFlows(), '--md', '--at', 'HEAD~1');
    expect(before.out).not.toContain('✗');
  });

  it('the review file lists the steps with their flow title and the page ids, and the flows gaps', async () => {
    await run(withFlows(), '--output', 'web');
    const review = JSON.parse(readFileSync(join(outDir(), outFiles().find((n) => n.endsWith('.review.json'))!), 'utf8'));
    expect(review.change.kind).toBe('map');
    expect(review.nodes.map((n: { id: string }) => n.id)).toEqual(['api', 'billing', 'email', 'stripe', 'flow:create/receive', 'flow:create/zero', 'flow:create/skip', 'flow:create/charge', 'flow:receipt/build', 'flow:receipt/mail']);
    expect(review.nodes[5]).toMatchObject({ label: 'Create an invoice: Is the total zero?', path: 'app/billing.ts' });
    expect(review.nodes[5].rev).toMatch(/^[0-9a-f]{12}$/);
    expect(review.edges).toContainEqual({ from: 'flow:create/zero', to: 'flow:create/skip', label: 'yes' });
    expect(review.gaps).toEqual(['refund job: not read', 'Create an invoice: retries: not read']);
  });
});
