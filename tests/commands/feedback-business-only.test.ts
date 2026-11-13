import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { repoFolder } from '../../src/render/output-path.js';
import { readReview, updateReview } from '../../src/review/store.js';
import { business, TECH } from '../fixtures/business.js';
import { git, makeSandbox, removeSandbox, repoFromTemplate, runCli, type Sandbox } from '../helpers/sandbox.js';

let sb: Sandbox;

function seed(dir: string) {
  writeFileSync(join(dir, 'app.ts'), 'one\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
}

beforeEach(() => {
  sb = makeSandbox('fb-business-only', { htmlOut: true });
  repoFromTemplate(sb.repo, seed);
});
afterEach(() => removeSandbox(sb.tmp));

const run = (args: string[]) => {
  process.exitCode = undefined;
  return runCli({ cwd: sb.repo, home: sb.home, now: () => new Date(2026, 10, 8, 10, 0, 0), isTTY: false }, args);
};
const dir = () => join(sb.out, repoFolder(sb.repo));

describe('feedback in a repo that has only a business page', () => {
  it('prints the business page notes', async () => {
    writeFileSync(join(sb.tmp, 'tech.json'), JSON.stringify(TECH));
    writeFileSync(join(sb.tmp, 'business.json'), JSON.stringify(business()));
    await run(['render', join(sb.tmp, 'tech.json'), '--output', 'cli']);
    await run(['render', join(sb.tmp, 'business.json')]);
    for (const n of readdirSync(dir()).filter((f) => f.endsWith('.review.json') && !f.includes('.business.'))) rmSync(join(dir(), n));
    const file = join(dir(), readdirSync(dir()).find((f) => f.endsWith('.business.review.json'))!);
    const review = readReview(file)!;
    updateReview(file, (r) => ({ ...r, notes: [{ id: 'n1', node: review.nodes[0]!.id, kind: 'comment', body: 'check the annual plans', state: 'pending', at: new Date(2026, 10, 8).toISOString() }] }));
    const r = await run(['feedback']);
    expect(r.err).toBe('');
    expect(r.out).toContain('check the annual plans');
    expect(r.code).toBeUndefined();
  });
});
