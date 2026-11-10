// @vitest-environment happy-dom
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { repoFolder } from '../../src/render/output-path.js';
import { FINISH_LIMIT } from '../../src/render/web/browser/finish.js';
import { MAX_IMPORT_BYTES } from '../../src/review/import.js';
import { readReview } from '../../src/review/store.js';
import { release } from '../fixtures/release.js';
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
  sb = makeSandbox('release-rt', { htmlOut: true });
  repoFromTemplate(sb.repo, seed);
});
afterEach(() => removeSandbox(sb.tmp));

let tick = 0;
const run = (args: string[], extra: object = {}) => {
  process.exitCode = undefined;
  const now = new Date(2026, 10, 9, 10, 0, tick++);
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
const releaseReview = () => readReview(join(dir(), named('.business.review.json').at(-1)!))!;

async function takeNotes(): Promise<string> {
  await run(['render', fileOf('release.json', release())]);
  mount(readFileSync(join(dir(), named('.business.html').at(-1)!), 'utf8'));
  const set = (sel: string, text: string) => {
    const el = q<HTMLTextAreaElement>(sel);
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  click(q('[data-item="R1"] [data-verdict="no"]'));
  set('[data-note="R1"]', 'Only above 500 euros');
  click(q('[data-item="D1"] [data-verdict="yes"]'));
  set('[data-answer="Q1"]', 'Any manager can approve');
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  click(q('#send'));
  await new Promise((r) => setTimeout(r, 0));
  return writeText.mock.calls[0]![0] as string;
}

describe('release page → Send back → feedback --import', () => {
  it('writes the page and review file under the business name and prints one summary line', async () => {
    const r = await run(['render', fileOf('release.json', release())]);
    expect(r.err).toBe('');
    expect(r.out).toMatch(/^Release map: What is new in Shop 2\.0 \(2\.0\.0\) · 3 features · 1 new · 1 changed · 1 fixed · 3 agent's readings\nfull map → file:\/\/.*\.business\.html\n$/);
    expect(named('.business.html')).toHaveLength(1);
    expect(releaseReview().change).toMatchObject({ kind: 'business', title: 'What is new in Shop 2.0' });
    expect(releaseReview().nodes.map((n) => n.id)).toEqual(['J1', 'J2', 'R1', 'R2', 'D1', 'Q1']);
  });

  it('imports the owner\'s answers into the review, with the items named and no links', async () => {
    const text = await takeNotes();
    const r = await run(['feedback', '--import'], stdin(text));
    expect(r.err).toBe('✔ Imported 3 notes into "What is new in Shop 2.0"\n');
    expect(r.out).toBe('3 notes saved — 1 answer · 1 confirmed · 1 rejected · 0 comments\n');
    expect(releaseReview().notes.map((n) => [n.node, n.kind, n.state])).toEqual([['R1', 'reject', 'pending'], ['Q1', 'answer', 'pending'], ['D1', 'confirm', 'pending']]);
    const fb = await run(['feedback']);
    expect(fb.out).toBe(
      [
        '# Review feedback: What is new in Shop 2.0 (3 notes)',
        '',
        '1. Rule "Manager approval" [R1]',
        '   Rejected: Only above 500 euros',
        '',
        '2. Question "What happens when an agent has no manager?" [Q1] (about rule "Manager approval")',
        '   Answer: Any manager can approve',
        '',
        '3. Saved data "Refund reason" [D1]',
        '   Confirmed',
        '',
      ].join('\n'),
    );
  });

  it('sends the short v2 token for the release page', async () => {
    const token = (await takeNotes()).trim().split(' · ').at(-1)!;
    expect(JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))).toMatchObject({ v: 2, s: 'what-is-new-in-shop-2-0' });
  });

  it('a note on an item whose words changed in a new render comes in outdated; re-rendering keeps the notes', async () => {
    const text = await takeNotes();
    await run(['feedback', '--import'], stdin(text));
    await run(['render', fileOf('release.json', release())]);
    expect(releaseReview().notes.map((n) => n.state)).toEqual(['pending', 'pending', 'pending']);
    const spec = release();
    spec.sections[0].rules[0].after = 'Other words entirely';
    await run(['render', fileOf('release2.json', spec)]);
    const again = await run(['feedback', '--import'], stdin(text));
    expect(again.err).toBe('Nothing new to import: these notes are already saved.\n');
    expect(releaseReview().notes.map((n) => [n.node, n.state])).toEqual([['R1', 'outdated'], ['Q1', 'pending'], ['D1', 'pending']]);
  });

  it('--change finds the release page by its title', async () => {
    await run(['feedback', '--import'], stdin(await takeNotes()));
    expect((await run(['feedback', '--change', 'What is new in Shop 2.0'])).out).toContain('Rule "Manager approval"');
  });

  it('refuses --pr and --tech', async () => {
    const spec = fileOf('release.json', release());
    expect((await run(['render', spec, '--pr'])).err).toContain('release maps are not for PR descriptions');
    expect((await run(['render', spec, '--tech', spec])).err).toContain('--tech only applies to business maps');
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests edit fields freely
const biggest = (): Record<string, any> => {
  const spec = release();
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  spec.sections = Array.from({ length: 12 }, (_, i) => ({
    id: `s${i}`,
    title: `Feature ${i}`,
    change: 'new',
    summary: 'It works.',
    journeys: Array.from({ length: 4 }, () => ({ id: id('J'), name: `Journey ${n}`, now: [{ text: 'Before' }], after: [{ text: 'After', change: 'new' }], evidence: 'checked' })),
    rules: Array.from({ length: 6 }, () => ({ id: id('R'), name: `Rule ${n}`, after: 'New words.', evidence: 'checked' })),
    data: Array.from({ length: 4 }, () => ({ id: id('D'), name: `Data ${n}`, what: 'Things kept', why: 'To know', evidence: 'checked' })),
  }));
  return spec;
};

describe('a long reply from a big release page', () => {
  const prepare = async (): Promise<void> => {
    await run(['render', fileOf('big.json', biggest())]);
    mount(readFileSync(join(dir(), named('.business.html').at(-1)!), 'utf8'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  };

  it('splits into messages that each import on their own', async () => {
    await prepare();
    const cards = [...document.querySelectorAll<HTMLElement>('[data-item]')].filter((c) => c.dataset.kind !== 'question');
    expect(cards).toHaveLength(168);
    for (const c of cards) {
      const ta = c.querySelector<HTMLTextAreaElement>('[data-note]')!;
      ta.value = 'é'.repeat(2000);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const writeText = vi.mocked(navigator.clipboard.writeText);
    click(q('#send'));
    await new Promise((r) => setTimeout(r, 0));
    const parts = [writeText.mock.calls[0]![0] as string];
    while (!q<HTMLElement>('#send-next').hidden) {
      expect(q('#send-part').textContent).toContain(`Message ${parts.length} of`);
      click(q('#send-next'));
      await new Promise((r) => setTimeout(r, 0));
      parts.push(writeText.mock.calls.at(-1)![0] as string);
    }
    expect(parts.length).toBeGreaterThan(1);
    expect(q('#send-part').textContent).toContain(`Message ${parts.length} of ${parts.length}. This is the last one.`);
    let imported = 0;
    for (const text of parts) {
      expect(Buffer.byteLength(text)).toBeLessThan(FINISH_LIMIT);
      expect(FINISH_LIMIT).toBeLessThan(MAX_IMPORT_BYTES);
      expect(text.split('\n').at(-1)).toMatch(/^codechart review · \d+ notes? · \S+$/);
      const r = await run(['feedback', '--import'], stdin(text));
      expect(r.err).toMatch(/^✔ Imported \d+ notes into/);
      imported += Number(/Imported (\d+)/.exec(r.err)![1]);
    }
    expect(imported).toBe(168);
    expect(releaseReview().notes).toHaveLength(168);
  });

  it('a normal-size reply stays one message with no part line', async () => {
    const text = await takeNotes();
    expect(q<HTMLElement>('#send-part').hidden).toBe(true);
    expect(q<HTMLElement>('#send-next').hidden).toBe(true);
    expect(q('#send-text').textContent).toBe(text);
    expect(text).toMatch(/^Review done: 3 answers and notes on "What is new in Shop 2\.0"\.\n1\. On rule "Manager approval": /);
  });
});
