// @vitest-environment happy-dom
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { repoFolder } from '../../src/render/output-path.js';
import { readReview } from '../../src/review/store.js';
import { business, businessExplain, TECH } from '../fixtures/business.js';
import { EXPLAIN_FILES, withFlows } from '../fixtures/explain.js';
import { click, mount, q, usePages } from '../helpers/page.js';
import { git, makeSandbox, removeSandbox, repoFromTemplate, runCli, type Sandbox } from '../helpers/sandbox.js';

usePages();

let sb: Sandbox;

function seed(dir: string) {
  writeFileSync(join(dir, 'app.ts'), 'one\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
}

beforeEach(() => {
  sb = makeSandbox('business-rt', { htmlOut: true });
  repoFromTemplate(sb.repo, seed);
});
afterEach(() => removeSandbox(sb.tmp));

let tick = 0;
const run = (args: string[], extra: object = {}) => {
  process.exitCode = undefined;
  const now = new Date(2026, 10, 8, 10, 0, tick++);
  return runCli({ cwd: sb.repo, home: sb.home, now: () => now, isTTY: false, ...extra }, args);
};
const fileOf = (name: string, spec: unknown): string => {
  const file = join(sb.tmp, name);
  writeFileSync(file, JSON.stringify(spec));
  return file;
};
const stdin = (text: string) => ({ stdin: async () => text });
const dir = () => join(sb.out, repoFolder(sb.repo));
const named = (ext: string) => readdirSync(dir()).filter((n) => n.endsWith(ext)).sort();
const businessReview = () => readReview(join(dir(), named('.business.review.json').at(-1)!))!;
const ids = (r: ReturnType<typeof businessReview>) => r.notes.map((n) => [n.node, n.kind, n.state]);

async function takeNotes(): Promise<string> {
  await run(['render', fileOf('tech.json', TECH), '--output', 'cli']);
  await run(['render', fileOf('business.json', business())]);
  mount(readFileSync(join(dir(), named('.business.html').at(-1)!), 'utf8'));
  const set = (sel: string, text: string) => {
    const el = q<HTMLTextAreaElement>(sel);
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  click(q('[data-item="R2"] [data-verdict="no"]'));
  set('[data-note="R2"]', 'Annual plans also get 14 days');
  click(q('[data-item="J2"] [data-verdict="yes"]'));
  set('[data-answer="Q1"]', 'The agent can send it to any manager');
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  click(q('#send'));
  await new Promise((r) => setTimeout(r, 0));
  return writeText.mock.calls[0]![0] as string;
}

describe('business page → Send back → feedback --import', () => {
  it('imports into the business review and shows the notes with their tech map links', async () => {
    const text = await takeNotes();
    const r = await run(['feedback', '--import'], stdin(text));
    expect(r.err).toBe('✔ Imported 3 notes into "New refund rules"\n');
    expect(r.out).toBe('3 notes saved — 1 answer · 1 confirmed · 1 rejected · 0 comments\n');
    expect(ids(businessReview())).toEqual([['J2', 'confirm', 'pending'], ['R2', 'reject', 'pending'], ['Q1', 'answer', 'pending']]);

    const fb = await run(['feedback']);
    expect(fb.out).toBe(
      [
        '# Review feedback: New refund rules (3 notes)',
        '',
        '1. Journey "Money reaches the customer" [J2] (links: instant-refunds-flag)',
        '   Confirmed',
        '',
        '2. Rule "Manager approval" [R2] (links: approvals)',
        '   Rejected: Annual plans also get 14 days',
        '',
        '3. Question "What happens when an agent has no manager?" [Q1] (about rule "Manager approval"; links: approvals)',
        '   Answer: The agent can send it to any manager',
        '',
      ].join('\n'),
    );
  });

  it('the copied token is the short v2 one', async () => {
    const text = await takeNotes();
    const token = text.trim().split(' · ').at(-1)!;
    expect(JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))).toMatchObject({ v: 2, s: 'new-refund-rules' });
    expect(token.length).toBeLessThanOrEqual(230);
  });

  it('changing a rule\'s words after the page was drawn marks its note outdated', async () => {
    const text = await takeNotes();
    const spec = business();
    spec.rules = spec.rules.map((r: { id: string }) => (r.id === 'R2' ? { ...r, after: 'Other words entirely' } : r));
    await run(['render', fileOf('business2.json', spec), '--tech', fileOf('tech.json', TECH)]);
    const r = await run(['feedback', '--import'], stdin(text));
    expect(r.err).toBe('✔ Imported 3 notes into "New refund rules" (1 outdated: the map changed since the page was drawn)\n');
    expect(ids(businessReview())).toEqual([['J2', 'confirm', 'pending'], ['R2', 'reject', 'outdated'], ['Q1', 'answer', 'pending']]);
  });

  it('a v2 token with an unknown kind code or a bad rev is refused', async () => {
    for (const n of [['J1', 'x', 'abcdef'], ['J1', 'c', 'abc']]) {
      const token = Buffer.from(JSON.stringify({ v: 2, s: 'x', b: 'b', n: [n] })).toString('base64url');
      const r = await run(['feedback', '--import'], stdin(`1. On rule "R": Comment: ok\n\ncodechart review · 1 note · ${token}\n`));
      expect(r.err).toContain('damaged');
    }
  });

  it('--take marks them sent, and the same text imports once', async () => {
    const text = await takeNotes();
    expect((await run(['feedback', '--import', '--take'], stdin(text))).out).toContain('Rejected: Annual plans also get 14 days');
    expect(businessReview().notes.map((n) => n.state)).toEqual(['sent', 'sent', 'sent']);
    expect((await run(['feedback', '--take'])).out).toBe('No pending review notes.\n');
    expect((await run(['feedback', '--import'], stdin(text))).err).toBe('Nothing new to import: these notes are already saved.\n');
  });

  it('--change finds the business page by its title', async () => {
    const text = await takeNotes();
    await run(['feedback', '--import'], stdin(text));
    await run(['render', fileOf('tech2.json', { ...TECH, title: 'Other map' }), '--output', 'cli']);
    expect((await run(['feedback', '--change', 'New refund rules'])).out).toContain('Rule "Manager approval"');
    expect((await run(['feedback'])).out).toContain('Rule "Manager approval"');
  });

  it('--change prefers a map with that title over a newer business page', async () => {
    await run(['render', fileOf('same.json', { ...TECH, title: 'New refund rules' }), '--output', 'cli']);
    const text = await takeNotes();
    await run(['feedback', '--import'], stdin(text));
    expect((await run(['feedback', '--change', 'New refund rules'])).out).toBe('No pending review notes.\n');
  });

  it('a note on an item the new render dropped comes in outdated', async () => {
    const text = await takeNotes();
    const spec = business();
    spec.rules = spec.rules.slice(0, 1);
    spec.questions = [];
    await run(['render', fileOf('business2.json', spec), '--tech', fileOf('tech.json', TECH)]);
    const r = await run(['feedback', '--import'], stdin(text));
    expect(r.err).toBe('✔ Imported 3 notes into "New refund rules" (2 outdated: the map changed since the page was drawn)\n');
    expect(ids(businessReview())).toEqual([['J2', 'confirm', 'pending'], ['R2', 'reject', 'outdated'], ['Q1', 'answer', 'outdated']]);
  });

  it('re-rendering the page keeps the imported notes', async () => {
    const text = await takeNotes();
    await run(['feedback', '--import'], stdin(text));
    await run(['render', fileOf('business.json', business()), '--tech', fileOf('tech.json', TECH)]);
    expect(businessReview().notes).toHaveLength(3);
    expect(businessReview().notes.map((n) => n.state)).toEqual(['pending', 'pending', 'pending']);
  });

  it('a map still gets the map notes, and its review is not the business one', async () => {
    const map = { title: 'Orders', kind: 'summary', nodes: [{ id: 'Order', label: 'Order', kind: 'model', status: 'changed', layer: 'backend' }], edges: [] };
    await run(['render', fileOf('map.json', map), '--output', 'web']);
    const branch = readReview(join(dir(), named('.review.json')[0]!))!.change.branch;
    const token = Buffer.from(JSON.stringify({ v: 1, slug: 'orders', branch, at: 'x', notes: [{ t: { title: true }, k: 'comment' }] })).toString('base64url');
    const r = await run(['feedback', '--import'], stdin(`Review done: 1 note on "Orders".\n1. On the title: Comment: rename it\n\ncodechart review · 1 note · ${token}\n`));
    expect(r.err).toBe('✔ Imported 1 note into "Orders"\n');
    expect((await run(['feedback'])).out).toContain('On the title\n   Comment: rename it');
  });

  it('an unknown note kind in the token is refused', async () => {
    const token = Buffer.from(JSON.stringify({ v: 1, slug: 'x', branch: 'b', at: 'x', notes: [{ t: { node: 'J1' }, k: 'approve' }] })).toString('base64url');
    const r = await run(['feedback', '--import'], stdin(`1. On rule "R": Approve: ok\n\ncodechart review · 1 note · ${token}\n`));
    expect(r.err).toContain('damaged');
    expect(r.code).toBe(1);
  });
});

describe('business explain page', () => {
  it('is read-only: no review file, no controls, no questions or jump links', async () => {
    for (const [file, text] of Object.entries(EXPLAIN_FILES)) {
      mkdirSync(join(sb.repo, file, '..'), { recursive: true });
      writeFileSync(join(sb.repo, file), text);
    }
    await run(['render', fileOf('explain.json', withFlows()), '--output', 'cli']);
    await run(['render', fileOf('business.json', businessExplain())]);
    expect(named('.business.review.json')).toEqual([]);
    mount(readFileSync(join(dir(), named('.business.html').at(-1)!), 'utf8'));
    expect(document.querySelector('#send, #send-modal, .bar, textarea, [data-cbtn], [data-verdict]')).toBeNull();
    expect(document.querySelector('a[data-jump], .qa, #questions')).toBeNull();
    expect(document.querySelectorAll('svg.flow .fn').length).toBeGreaterThan(0);
  });
});
