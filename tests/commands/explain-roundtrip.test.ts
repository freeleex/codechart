// @vitest-environment happy-dom
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { repoFolder } from '../../src/render/output-path.js';
import { readReview } from '../../src/review/store.js';
import { explain, EXPLAIN_FILES } from '../fixtures/explain.js';
import { click, mount, node, q, qa, usePages } from '../helpers/page.js';
import { git, makeSandbox, removeSandbox, runCli } from '../helpers/sandbox.js';

usePages();

let tmp: string;
let home: string;
let repo: string;
let out: string;
const drawn = new Date(2026, 10, 10, 9, 0, 0);

beforeEach(() => {
  ({ tmp, home, repo, out } = makeSandbox('explain-roundtrip', { git: 'init', htmlOut: true }));
  for (const [file, text] of Object.entries(EXPLAIN_FILES)) {
    mkdirSync(join(repo, file, '..'), { recursive: true });
    writeFileSync(join(repo, file), text);
  }
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
});
afterEach(() => removeSandbox(tmp));

const run = (args: string[], stdin?: string) => runCli({ cwd: repo, home, now: () => drawn, isTTY: false, ...(stdin !== undefined && { stdin: async () => stdin }) }, args);
const dir = () => join(out, repoFolder(repo));
const names = (ext: string) => readdirSync(dir()).filter((n) => n.endsWith(ext));

const save = (text: string) => {
  const ta = q<HTMLTextAreaElement>('.cm-composer textarea');
  ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  click(q('.cm-save'));
};

describe('explain page → Finish review → feedback --import', () => {
  it('notes on a box and a gap come back, with the box label and its file, and nothing is stale', async () => {
    writeFileSync(join(tmp, 'spec.json'), JSON.stringify(explain()));
    const r = await run(['render', join(tmp, 'spec.json'), '--output', 'web']);
    expect(r.err).toBe('');
    mount(readFileSync(join(dir(), names('.html')[0]!), 'utf8'));
    click(node('billing'));
    click(q('#panel .cm-node-btn'));
    save('why skip a zero total?');
    click(q('#page-info [data-notes="gap"] .cm-btn'));
    save('please read the refund job');

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    click(q('#finish-review'));
    click(q('.cm-copy'));
    await new Promise((res) => setTimeout(res, 0));
    const text = writeText.mock.calls[0]![0] as string;
    expect(qa('#finish-review')).toHaveLength(1);

    const imported = await run(['feedback', '--import', '--take'], text);
    expect(imported.err).toBe('✔ Imported 2 notes into "How billing works"\n');
    expect(imported.out).toContain('1. BillingService (app/billing.ts)  [billing]\n   Comment: why skip a zero total?');
    expect(imported.out).toContain('2. On the gap “refund job: not read”\n   Comment: please read the refund job');
    const review = readReview(join(dir(), names('.review.json')[0]!))!;
    expect(review.change.kind).toBe('map');
    expect(review.notes.map((n) => n.state)).toEqual(['sent', 'sent']);
  });
});
