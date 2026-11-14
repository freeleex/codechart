import { existsSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pruneHtml } from '../../src/render/prune.js';
import type { Review } from '../../src/review/schema.js';
import { findChange, listReviews, readReview, reviewLock, saveReview, updateReview, writeReview, type Found } from '../../src/review/store.js';
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

  it.each([['truncated', '{"version":1,"change":{"slug":"inv'], ['garbage', 'not json at all \u0000\u0001']])('findChange says a %s review file is damaged, not that there is no map', (_n, content) => {
    const file = join(dir, '20261028-090001-invites.review.json');
    writeFileSync(file, content);
    expect(() => findChange(dir, 'main')).toThrow(`${file} can't be read (damaged): ask your agent to draw the map again.`);
    expect(() => findChange(dir, 'main', 'invites')).toThrow("can't be read (damaged)");
  });

  it('a readable older review is still used next to a damaged newer one', () => {
    save(1);
    writeFileSync(join(dir, '20261028-090009-invites.review.json'), '{');
    expect(findChange(dir, 'main').review.change.slug).toBe('invites');
  });

  it('a readable review of another branch next to a damaged file still reports the damage', () => {
    save(1, { branch: 'feat' });
    writeFileSync(join(dir, '20261028-090009-other.review.json'), '{');
    expect(() => findChange(dir, 'main')).toThrow("can't be read (damaged)");
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

describe('writing review files', () => {
  const times = { waitMs: 150, staleMs: 10_000 };
  const lock = () => reviewLock(dir, 'main', 'invites');
  const first = () => {
    const html = save(1);
    return html.replace('.html', '.review.json');
  };
  const found = (file: string): Found => ({ file, review: readReview(file)! });

  it('writeReview leaves a whole file and no temp file behind', () => {
    const file = first();
    writeReview(file, { ...readReview(file)!, notes: [note('n1')] });
    expect(readReview(file)!.notes).toHaveLength(1);
    expect(readdirSync(dir).filter((n) => !n.endsWith('.html') && !n.endsWith('.review.json'))).toEqual([]);
  });

  it('a write that fails keeps the old file and removes its temp file', () => {
    const file = first();
    const before = readReview(file)!;
    const circular = { ...before, nodes: [{ id: 'x', label: 'x', get path(): string { throw new Error('boom'); } }] };
    expect(() => writeReview(file, circular as never)).toThrow('boom');
    expect(readReview(file)).toEqual(before);
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('updateReview reads the file again under the lock: a note saved since the caller looked is kept', () => {
    const file = first();
    const stale = found(file);
    writeReview(file, { ...stale.review, notes: [note('n1', { body: 'saved meanwhile' })] });
    const out = updateReview(stale, (cur) => ({ ...cur, notes: [...cur.notes, note('n2')] }), times);
    expect(out.notes.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(readReview(file)!.notes.map((n) => n.id)).toEqual(['n1', 'n2']);
  });

  it('returning the same review writes nothing', () => {
    const file = first();
    const m = statSync(file).mtimeMs;
    updateReview(found(file), (cur) => cur, times);
    expect(statSync(file).mtimeMs).toBe(m);
  });

  it('the lock is released after a change, and after one that throws', () => {
    const file = first();
    updateReview(found(file), (cur) => ({ ...cur, notes: [note('n1')] }), times);
    expect(existsSync(lock())).toBe(false);
    expect(() => updateReview(found(file), () => { throw new Error('nope'); }, times)).toThrow('nope');
    expect(existsSync(lock())).toBe(false);
  });

  it('a lock held by another command makes it wait, then say so; the file is untouched', () => {
    const file = first();
    writeFileSync(lock(), '');
    const before = readReview(file)!;
    expect(() => updateReview(found(file), (cur) => ({ ...cur, notes: [note('n1')] }), times)).toThrow('Another codechart command is saving these notes');
    expect(readReview(file)).toEqual(before);
    expect(existsSync(lock())).toBe(true);
  });

  it('a lock older than the stale age is a crashed command\'s and is taken over', () => {
    const file = first();
    writeFileSync(lock(), '');
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock(), old, old);
    updateReview(found(file), (cur) => ({ ...cur, notes: [note('n1')] }), times);
    expect(readReview(file)!.notes).toHaveLength(1);
    expect(existsSync(lock())).toBe(false);
  });

  it('a review file that cannot be read is an error, not an empty review', () => {
    const file = first();
    const f = found(file);
    writeFileSync(file, '{');
    expect(() => updateReview(f, (cur) => cur, times)).toThrow(`The review notes in ${file} can't be read.`);
  });

  it('one lock per map and branch: its name does not change when a new render replaces the file, and differs per branch and slug', () => {
    expect(reviewLock(dir, 'main', 'invites')).toBe(lock());
    expect(new Set([lock(), reviewLock(dir, 'feat', 'invites'), reviewLock(dir, 'main', 'other'), reviewLock(dir, 'feat/x', 'invites')]).size).toBe(4);
    expect(lock().startsWith(dir)).toBe(true);
  });

  it('lock and temp files are never taken for reviews', () => {
    const file = first();
    writeFileSync(lock(), '');
    writeFileSync(`${file}.1234.tmp`, '{}');
    mkdirSync(join(dir, 'sub'));
    expect(listReviews(dir, 'main')).toHaveLength(1);
  });
});

describe('saving over a previous review', () => {
  const times = { waitMs: 1000, staleMs: 10_000 };
  const lock = () => reviewLock(dir, 'main', 'invites');
  const base = (s: number) => {
    const html = page(`20261028-0900${String(s).padStart(2, '0')}-invites.html`);
    return { dir, file: html.replace('.html', '.review.json'), html, slug: 'invites', branch: 'main', now: at(s), snapshot: { kind: 'map' as const, nodes: [api, mailer] } };
  };
  /** A whole render, as src/render/web/write.ts does it: write the new file, then remove the one it replaced. */
  const render = (s: number, replaced: string) => {
    const next = base(s);
    saveReview({ ...next, afterWrite: () => rmSync(replaced) });
    return next.file;
  };
  const addNote = (id: string) => (cur: Review): Review => ({ ...cur, notes: [...cur.notes, note(id)] });

  it('a render waits for a note being saved, then carries it over', () => {
    const prevFile = save(1).replace('.html', '.review.json');
    writeFileSync(lock(), '');
    const next = base(2);
    let waited = 0;
    saveReview({
      ...next,
      lock: {
        ...times,
        sleep: () => {
          waited++;
          expect(existsSync(next.file)).toBe(false);
          writeReview(prevFile, { ...readReview(prevFile)!, notes: [note('n1', { body: 'added while saving' })] });
          rmSync(lock());
        },
      },
    });
    expect(waited).toBe(1);
    expect(readReview(next.file)!.notes.map((n) => n.id)).toEqual(['n1']);
    expect(existsSync(lock())).toBe(false);
  });

  it('a note that waited behind a render lands in the new file, not the one the render removed', () => {
    const prevFile = save(1).replace('.html', '.review.json');
    const chosen: Found = { file: prevFile, review: readReview(prevFile)! };
    writeFileSync(lock(), '');
    let newFile = '';
    const out = updateReview(chosen, addNote('n1'), {
      ...times,
      sleep: () => {
        rmSync(lock());
        newFile = render(2, prevFile);
      },
    });
    expect(out.notes.map((n) => n.id)).toEqual(['n1']);
    expect(existsSync(prevFile)).toBe(false);
    expect(readReview(newFile)!.notes.map((n) => n.id)).toEqual(['n1']);
    expect(existsSync(lock())).toBe(false);
  });

  it('two renders racing: the second reads the first one\'s file under the lock, so a note added between them survives', () => {
    const prevFile = save(1).replace('.html', '.review.json');
    writeFileSync(lock(), '');
    const last = base(3);
    let waited = 0;
    saveReview({
      ...last,
      afterWrite: () => {
        for (const n of readdirSync(dir).filter((n) => n.endsWith('.review.json') && join(dir, n) !== last.file)) rmSync(join(dir, n));
      },
      lock: {
        ...times,
        sleep: () => {
          waited++;
          rmSync(lock());
          const second = render(2, prevFile);
          updateReview({ file: second, review: readReview(second)! }, addNote('n1'), times);
        },
      },
    });
    expect(waited).toBe(1);
    expect(readReview(last.file)!.notes.map((n) => n.id)).toEqual(['n1']);
    expect(readdirSync(dir).filter((n) => n.endsWith('.review.json'))).toEqual([basename(last.file)]);
    expect(existsSync(lock())).toBe(false);
  });

  it('holds the lock until afterWrite is done, and releases it when afterWrite throws', () => {
    save(1);
    const next = base(2);
    let heldDuring = false;
    expect(() =>
      saveReview({
        ...next,
        afterWrite: () => {
          heldDuring = existsSync(lock()) && existsSync(next.file);
          throw new Error('boom');
        },
      }),
    ).toThrow('boom');
    expect(heldDuring).toBe(true);
    expect(existsSync(lock())).toBe(false);
  });

  it('a lock that stays held fails the save and writes nothing', () => {
    save(1);
    writeFileSync(lock(), '');
    const next = base(2);
    expect(() => saveReview({ ...next, lock: { waitMs: 50, staleMs: 10_000 } })).toThrow('Another codechart command is saving these notes');
    expect(existsSync(next.file)).toBe(false);
  });

  it('with no previous file afterWrite still runs, and no lock is left behind', () => {
    const next = base(1);
    let ran = false;
    saveReview({ ...next, afterWrite: () => { ran = true; } });
    expect(ran).toBe(true);
    expect(readdirSync(dir).filter((n) => n.endsWith('.lock'))).toEqual([]);
  });

  it('a page-less render after a page render: a waiting note lands on the file feedback reads', () => {
    const pageFile = save(1).replace('.html', '.review.json');
    const chosen: Found = { file: pageFile, review: readReview(pageFile)! };
    writeFileSync(lock(), '');
    const pageless = join(dir, '20261028-090002-invites.review.json');
    updateReview(chosen, addNote('n1'), {
      ...times,
      sleep: () => {
        rmSync(lock());
        saveReview({ dir, file: pageless, slug: 'invites', branch: 'main', now: at(2), snapshot: { kind: 'map', nodes: [api, mailer] } });
      },
    });
    expect(findChange(dir, 'main').file).toBe(pageless);
    expect(readReview(pageless)!.notes.map((n) => n.id)).toEqual(['n1']);
  });
});
