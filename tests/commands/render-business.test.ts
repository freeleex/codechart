import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { business, TECH } from '../fixtures/business.js';
import { git, makeSandbox, removeSandbox, repoFromTemplate, runCli, type Sandbox } from '../helpers/sandbox.js';

let sb: Sandbox;

function seed(dir: string) {
  writeFileSync(join(dir, 'app.ts'), 'one\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
}

beforeEach(() => {
  sb = makeSandbox('business', { htmlOut: true });
  repoFromTemplate(sb.repo, seed);
});
afterEach(() => removeSandbox(sb.tmp));

const fileOf = (name: string, spec: unknown): string => {
  const file = join(sb.tmp, name);
  writeFileSync(file, JSON.stringify(spec));
  return file;
};

let tick = 0;
const run = (args: string[]) => {
  process.exitCode = undefined;
  const now = new Date(2026, 10, 8, 10, 0, tick++);
  return runCli({ cwd: sb.repo, home: sb.home, now: () => now, isTTY: false }, args);
};
const renderBusiness = (spec: unknown, ...args: string[]) => run(['render', fileOf('business.json', spec), ...args]);
const renderTech = () => run(['render', fileOf('tech.json', TECH), '--output', 'cli']);
const tech = () => fileOf('tech.json', TECH);

const outFiles = (): string[] => (existsSync(sb.out) ? readdirSync(sb.out).flatMap((d) => readdirSync(join(sb.out, d))) : []);
const reviewOf = (): { change: { kind: string; slug: string; title: string; html?: string }; nodes: { id: string; label: string }[]; notes: unknown[] } => {
  const dir = join(sb.out, readdirSync(sb.out)[0]!);
  const name = readdirSync(dir).find((n) => n.endsWith('.business.review.json'))!;
  return JSON.parse(readFileSync(join(dir, name), 'utf8'));
};

describe('render: business map', () => {
  it('with --tech: writes the page, a review file and prints one summary line with the link', async () => {
    const r = await renderBusiness(business(), '--tech', tech());
    expect(r.err).toBe('');
    expect(r.code).toBeUndefined();
    expect(r.out).toMatch(/^Business map: New refund rules · 2 journeys · 2 rules · 1 saved data · 1 question · 2 agent's readings\nfull map → file:\/\/.*\.business\.html\n$/);
    expect(outFiles().filter((n) => n.endsWith('.business.html'))).toHaveLength(1);
    const review = reviewOf();
    expect(review.change).toMatchObject({ kind: 'business', title: 'New refund rules' });
    expect(review.change.slug).toBe('new-refund-rules.business');
    expect(review.nodes.map((n) => n.id)).toEqual(['J1', 'J2', 'R1', 'R2', 'D1', 'Q1']);
    expect(review.notes).toEqual([]);
    const page = readFileSync(join(sb.out, readdirSync(sb.out)[0]!, outFiles().find((n) => n.endsWith('.business.html'))!), 'utf8');
    expect(page).toContain('New refund rules');
  });

  it('--md prints a paste-ready block with the link', async () => {
    const r = await renderBusiness(business(), '--tech', tech(), '--md');
    expect(r.out).toMatch(/^\*\*Business map: New refund rules.*\*\*\n\n\[Open full map\]\(file:\/\//);
  });

  it('writes the page for --output cli too: business maps are HTML only', async () => {
    const r = await renderBusiness(business(), '--tech', tech(), '--output', 'cli');
    expect(r.out).toContain('full map →');
    expect(outFiles().some((n) => n.endsWith('.business.html'))).toBe(true);
  });

  it('accepts diff flags and ignores them', async () => {
    const r = await renderBusiness(business(), '--tech', tech(), '--git');
    expect(r.code).toBeUndefined();
    expect(r.out).toContain('Business map:');
  });

  it('uses the tech map saved by an earlier render on this branch, newest page last', async () => {
    await renderTech();
    expect((await renderBusiness(business())).err).toBe('');
    // The business page just written is newer, and must not count as the tech map.
    const again = await renderBusiness(business());
    expect(again.err).toBe('');
    expect(again.out).toContain('Business map:');
  });

  it("uses the saved tech map named by the spec's map", async () => {
    await renderTech();
    expect((await renderBusiness({ ...business(), map: 'refund-rules' })).err).toBe('');
    const other = await renderBusiness({ ...business(), map: 'something-else' });
    expect(other.err).toContain('no tech map found for this change');
    expect(other.code).toBe(1);
  });

  it('fails without a tech map', async () => {
    const r = await renderBusiness(business());
    expect(r.err).toBe("codechart: no tech map found for this change: render the tech map first, or pass --tech '<spec.json>'\n");
    expect(r.code).toBe(1);
    expect(r.out).toBe('');
  });

  it('names a link that is not a box on the tech map', async () => {
    const spec = business();
    spec.journeys[1].links[0] = 'refund-api';
    const r = await renderBusiness(spec, '--tech', tech());
    expect(r.err).toBe('journeys[1].links[0]: "refund-api" is not a box on the tech map\n');
    expect(r.code).toBe(1);
    expect(outFiles()).toEqual([]);
  });

  it('refuses a tech map id in the words', async () => {
    const spec = business();
    spec.rules[1].after = 'The approvals box and the subscription-model box decide.';
    const r = await renderBusiness(spec, '--tech', tech());
    expect(r.err).toBe('rules[1].after: names a box of the tech map ("subscription-model"); write it in plain words\n');
  });

  it('reports a spec with code in its words, before looking for a tech map', async () => {
    const spec = business();
    spec.rules[0].after = 'Uses refundWindow';
    const r = await renderBusiness(spec);
    expect(r.err).toBe('rules[0].after: looks like code ("refundWindow"); write it in plain words\n');
    expect(r.code).toBe(1);
  });

  it('flow specs work as the tech map: their step ids are the boxes', async () => {
    const steps = ['refund-requests', 'approvals', 'email', 'instant-refunds-flag', 'refunds', 'refund-policy', 'subscription-model'].map((id) => ({ id, label: id, status: 'existing', source: 'app.ts:1' }));
    const links = steps.slice(1).map((s, i) => ({ from: steps[i]!.id, to: s.id }));
    const flow = { title: 'Refund flow', kind: 'summary', start: 'refund-requests', steps, links };
    const r = await renderBusiness(business(), '--tech', fileOf('flow.json', flow));
    expect(r.err).toBe('');
  });

  it('fails on a --tech file that is not a valid spec', async () => {
    const r = await renderBusiness(business(), '--tech', fileOf('bad.json', { title: 'x' }));
    expect(r.err).toContain('--tech');
    expect(r.code).toBe(1);
  });

  it('refuses --pr', async () => {
    const r = await renderBusiness(business(), '--tech', tech(), '--pr');
    expect(r.err).toBe('codechart: business maps are not for PR descriptions\n');
    expect(r.code).toBe(1);
  });

  it('--tech only applies to business maps', async () => {
    const r = await run(['render', tech(), '--tech', tech()]);
    expect(r.err).toBe('codechart: --tech only applies to business maps\n');
    expect(r.code).toBe(1);
  });

  it('prints invalid business specs the way maps do', async () => {
    const spec = business();
    spec.questions[0].about = 'R9';
    const r = await renderBusiness(spec, '--tech', tech());
    expect(r.err).toBe('questions[0].about: unknown journey, rule or saved data item "R9"\n');
    expect(r.code).toBe(1);
  });

  it('carries the notes of the earlier page of the same title', async () => {
    await renderBusiness(business(), '--tech', tech());
    const dir = join(sb.out, readdirSync(sb.out)[0]!);
    const file = join(dir, readdirSync(dir).find((n) => n.endsWith('.business.review.json'))!);
    const review = JSON.parse(readFileSync(file, 'utf8'));
    review.notes.push({ id: 'n1', node: 'R1', kind: 'comment', body: 'Why 14?', state: 'pending', at: '2026-11-08T10:00:00Z' });
    writeFileSync(file, JSON.stringify(review));
    await renderBusiness(business(), '--tech', tech());
    expect(reviewOf().notes).toEqual([expect.objectContaining({ id: 'n1', node: 'R1', state: 'pending' })]);
    expect(outFiles().filter((n) => n.endsWith('.business.review.json'))).toHaveLength(1);
  });
});

describe('schema --business', () => {
  it('prints the JSON schema', async () => {
    const r = await runCli({ cwd: sb.repo, home: sb.home }, ['schema', '--business']);
    const schema = JSON.parse(r.out);
    expect(schema.properties.diagram.const).toBe('business');
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['title', 'summary', 'map', 'journeys', 'rules', 'data', 'questions']));
  });

  it('does not combine with --flow or --config', async () => {
    const r = await runCli({ cwd: sb.repo, home: sb.home }, ['schema', '--business', '--flow']);
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
  });
});
