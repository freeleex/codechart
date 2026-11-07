import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../../src/config/schema.js';
import { repoFolder } from '../../src/render/output-path.js';
import { writeHtml, writeReviewOnly } from '../../src/render/web/write.js';
import { readReview, saveReview } from '../../src/review/store.js';
import { makeTempDir, removeTempDir } from '../helpers/sandbox.js';
import { api, note } from '../review/fixture.js';

let tmp: string;
let root: string;
let dir: string;
let config: Config;
const t1 = new Date(2026, 9, 28, 9, 0, 0);
const t2 = new Date(2026, 9, 28, 9, 5, 0);

beforeEach(() => {
  tmp = makeTempDir('write-review');
  root = join(tmp, 'repo');
  mkdirSync(root);
  config = { web: { outDir: join(tmp, 'out'), keep: 20, maxAgeDays: 7, open: 'never' } } as Config;
  dir = join(config.web.outDir, repoFolder(root));
  mkdirSync(dir, { recursive: true });
});
afterEach(() => removeTempDir(tmp));

/** An earlier render of slug "orders" with one note on it; the folder is no git repo, so its branch is ''. */
function earlier(): { page: string; review: string } {
  const page = join(dir, '20261028-090000-orders.html');
  const review = page.replace('.html', '.review.json');
  writeFileSync(page, '<html></html>');
  saveReview({ dir, file: review, html: page, slug: 'orders', branch: '', now: t1, snapshot: { kind: 'map', nodes: [api] } });
  const r = readReview(review)!;
  writeFileSync(review, JSON.stringify({ ...r, notes: [note('n1')] }));
  return { page, review };
}

const boom = () => {
  throw new Error('disk full');
};
const base = () => ({ config, root, slug: 'orders', theme: 'light' as const, now: t2, forceOpen: false, inEditor: false, open: () => undefined, stderr: (s: string) => void errors.push(s) });
let errors: string[] = [];
beforeEach(() => {
  errors = [];
});

describe('a review file that could not be saved', () => {
  it('writeHtml: the earlier page and review file, which hold the notes, are not replaced', async () => {
    const old = earlier();
    await writeHtml(async () => '<html>new</html>', { ...base(), review: boom });
    expect(errors.join('')).toContain("Couldn't save review notes (disk full)");
    expect(existsSync(old.page)).toBe(true);
    expect(readReview(old.review)!.notes).toHaveLength(1);
    expect(existsSync(join(dir, '20261028-090500-orders.html'))).toBe(true);
  });

  it('writeHtml: when it saved, the earlier page is replaced and the notes carried', async () => {
    const old = earlier();
    await writeHtml(async () => '<html>new</html>', { ...base(), review: () => ({ kind: 'map', nodes: [api] }) });
    expect(existsSync(old.page)).toBe(false);
    expect(readReview(join(dir, '20261028-090500-orders.review.json'))!.notes).toHaveLength(1);
  });

  it('writeReviewOnly: an earlier review file with no page is not replaced', () => {
    const old = earlier();
    rmSync(old.page);
    const r = readReview(old.review)!;
    const change = { ...r.change };
    delete change.html;
    writeFileSync(old.review, JSON.stringify({ ...r, change }));
    writeReviewOnly(boom, base());
    expect(errors.join('')).toContain("Couldn't save review notes (disk full)");
    expect(readReview(old.review)!.notes).toHaveLength(1);
  });
});

describe('the change a page carries', () => {
  it('names the slug, branch and render time of the review file written with it', async () => {
    let seen: unknown;
    const { file } = await writeHtml(async (meta) => ((seen = meta.change), '<html></html>'), { ...base(), review: () => ({ kind: 'map', nodes: [api] }) });
    const saved = readReview(file.replace('.html', '.review.json'))!;
    expect(seen).toEqual({ slug: 'orders', branch: saved.change.branch, at: saved.change.renderedAt });
    expect(saved.change.renderedAt).toBe(t2.toISOString());
  });

  it('is left out when no review file is written', async () => {
    let seen: unknown = 'unset';
    await writeHtml(async (meta) => ((seen = meta.change), '<html></html>'), base());
    expect(seen).toBeUndefined();
  });
});
