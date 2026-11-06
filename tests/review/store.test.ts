import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pruneHtml } from '../../src/render/prune.js';
import { findChange, listReviews, readReview, saveReview } from '../../src/review/store.js';
import { makeTempDir, removeTempDir } from '../helpers/sandbox.js';
import { api, mailer, note } from './fixture.js';

let dir: string;
beforeEach(() => {
  dir = makeTempDir('review-store');
});
afterEach(() => removeTempDir(dir));

const at = (s: number) => new Date(2026, 9, 28, 9, 0, s);
const page = (name: string) => {
  writeFileSync(join(dir, name), '<html></html>');
  return join(dir, name);
};

function save(s: number, o: { slug?: string; branch?: string; nodes?: typeof api[] } = {}) {
  const slug = o.slug ?? 'invites';
  const html = page(`20261028-0900${String(s).padStart(2, '0')}-${slug}.html`);
  saveReview({ dir, file: html.replace('.html', '.review.json'), html, slug, branch: o.branch ?? 'main', now: at(s), snapshot: { kind: 'map', nodes: o.nodes ?? [api, mailer] } });
  return html;
}

describe('review store', () => {
  it('writes <page>.review.json privately, with change and nodes', () => {
    const html = save(1);
    const file = html.replace('.html', '.review.json');
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readReview(file)).toMatchObject({ version: 1, change: { slug: 'invites', kind: 'map', branch: 'main', html }, nodes: [{ id: 'api' }, { id: 'mailer' }], notes: [] });
  });

  it('a re-render of the same slug and branch takes over notes; another branch or slug does not', () => {
    const first = save(1);
    const found = listReviews(dir, 'main')[0]!;
    writeFileSync(found.file, JSON.stringify({ ...found.review, notes: [note('n1')] }));
    save(2, { slug: 'other' });
    save(3, { branch: 'feat' });
    expect(readReview(first.replace('.html', '.review.json'))!.notes).toHaveLength(1);
    const next = save(4);
    expect(readReview(next.replace('.html', '.review.json'))!.notes).toEqual([note('n1')]);
  });

  it('an outdated carry-over: diff changed on re-render', () => {
    const first = save(1);
    const file = first.replace('.html', '.review.json');
    writeFileSync(file, JSON.stringify({ ...readReview(file)!, notes: [note('n1')] }));
    const next = save(2, { nodes: [{ ...api, rev: 'new' }] });
    expect(readReview(next.replace('.html', '.review.json'))!.notes[0]!.state).toBe('outdated');
  });

  it('a render in the same second keeps its notes', () => {
    const first = save(1);
    const file = first.replace('.html', '.review.json');
    writeFileSync(file, JSON.stringify({ ...readReview(file)!, notes: [note('n1')] }));
    save(1);
    expect(readReview(file)!.notes).toEqual([note('n1')]);
  });

  it('findChange: newest on the branch, or by slug; clear errors otherwise', () => {
    save(1, { slug: 'old' });
    save(2, { slug: 'new' });
    save(3, { slug: 'feat', branch: 'feat' });
    expect(findChange(dir, 'main').review.change.slug).toBe('new');
    expect(findChange(dir, 'main', 'old').review.change.slug).toBe('old');
    expect(() => findChange(dir, 'main', 'nope')).toThrow('No map called "nope" on branch main. Check the title, or ask your agent to draw it.');
    expect(() => findChange(dir, 'zzz')).toThrow('No map to review on branch zzz yet. Ask your agent for a map first.');
    expect(() => findChange(join(dir, 'missing'), 'main')).toThrow('Ask your agent for a map first.');
    expect(() => findChange(join(dir, 'missing'), '')).toThrow('No map to review here yet.');
  });

  it('findChange also takes the title, in any case', () => {
    const html = page('20261028-090001-invoices.html');
    saveReview({ dir, file: html.replace('.html', '.review.json'), html, slug: 'invoices', branch: 'main', now: at(1), snapshot: { kind: 'map', title: 'Invoices for paid orders', nodes: [api] } });
    expect(findChange(dir, 'main', 'INVOICES for paid orders').review.change.slug).toBe('invoices');
    expect(findChange(dir, 'main', 'invoices').review.change.title).toBe('Invoices for paid orders');
  });

  it('files that are not reviews are skipped', () => {
    writeFileSync(join(dir, '20261028-090001-bad.review.json'), '{"version":2}');
    save(2);
    expect(listReviews(dir, 'main')).toHaveLength(1);
  });
});

describe('pruning review files', () => {
  const opts = { keep: 20, maxAgeDays: 7, now: at(10) };

  it('the page of an older render goes with its review file', () => {
    const old = save(1);
    const current = save(10);
    pruneHtml(dir, { ...opts, replaceSlug: 'invites' });
    expect(existsSync(old)).toBe(false);
    expect(existsSync(old.replace('.html', '.review.json'))).toBe(false);
    expect(existsSync(current.replace('.html', '.review.json'))).toBe(true);
  });

  it('a review file whose page is gone is removed; other files stay', () => {
    const html = save(1);
    writeFileSync(join(dir, 'notes.txt'), 'x');
    pruneHtml(dir, { ...opts, now: at(10) });
    expect(existsSync(html.replace('.html', '.review.json'))).toBe(true);
    writeFileSync(join(dir, '20261028-090002-gone.review.json'), '{}');
    pruneHtml(dir, opts);
    expect(readdirSync(dir).sort()).toEqual(['20261028-090001-invites.html', '20261028-090001-invites.review.json', 'notes.txt']);
  });
});
