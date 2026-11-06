import { closeSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REVIEW_NAME } from '../render/output-path.js';
import { carryNotes } from './carry.js';
import { reviewSchema, type Range, type Review, type ReviewNode } from './schema.js';

export interface Found {
  file: string;
  review: Review;
}

export interface ReviewSnapshot {
  kind: 'map' | 'flow';
  title?: string;
  nodes: ReviewNode[];
  range?: Range;
}

export function readReview(file: string): Review | undefined {
  try {
    const parsed = reviewSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Written beside the file and renamed over it, so a reader never sees half a file. */
export function writeReview(file: string, review: Review): void {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(review, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

interface LockTimes {
  waitMs: number;
  staleMs: number;
}

const sleep = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Runs `fn` holding `<file>.lock` (created exclusively): a second command waits its turn, a lock older than `staleMs` is a crashed one's and goes. */
function withLock<T>(file: string, fn: () => T, { waitMs, staleMs }: LockTimes): T {
  const lock = `${file}.lock`;
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx', 0o600));
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const age = Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
    if (age > staleMs) rmSync(lock, { force: true });
    else if (Date.now() > until) throw new Error('Another codechart command is saving these notes. Try again in a moment.');
    else sleep(25);
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

/** Read, change and write the review file as one step: it is read again under the lock, so notes saved meanwhile by another command are not lost. */
export function updateReview(file: string, change: (current: Review) => Review, times: LockTimes = { waitMs: 2000, staleMs: 10_000 }): Review {
  return withLock(
    file,
    () => {
      const current = readReview(file);
      if (!current) throw new Error(`The review notes in ${file} can't be read.`);
      const next = change(current);
      if (next !== current) writeReview(file, next);
      return next;
    },
    times,
  );
}

/** The review files of `branch` in `dir`, newest page first. */
export function listReviews(dir: string, branch: string): Found[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => REVIEW_NAME.test(n))
    .sort()
    .reverse()
    .flatMap((n) => {
      const review = readReview(join(dir, n));
      return review && review.change.branch === branch ? [{ file: join(dir, n), review }] : [];
    });
}

const sameName = (r: Review, name: string): boolean => r.change.slug === name || (r.change.title ?? r.change.slug).toLowerCase() === name.toLowerCase();

/** The newest change on `branch`, or the one with this title or file name slug. */
export function findChange(dir: string, branch: string, name?: string): Found {
  const found = listReviews(dir, branch).find((f) => name === undefined || sameName(f.review, name));
  if (found) return found;
  const where = branch ? ` on branch ${branch}` : ' here';
  throw new Error(name === undefined ? `No map to review${where} yet. Ask your agent for a map first.` : `No map called "${name}"${where}. Check the title, or ask your agent to draw it.`);
}

/** Writes the review file `file`, taking over the notes of the last render of this slug on this branch. */
export function saveReview(o: { dir: string; file: string; html?: string; slug: string; branch: string; now: Date; snapshot: ReviewSnapshot }): void {
  const { slug, branch, snapshot } = o;
  const prev = listReviews(o.dir, branch).find((f) => f.review.change.slug === slug);
  writeReview(o.file, {
    version: 1,
    change: { slug, ...(snapshot.title && { title: snapshot.title }), kind: snapshot.kind, branch, ...(o.html && { html: o.html }), renderedAt: o.now.toISOString(), ...(snapshot.range && { range: snapshot.range }) },
    nodes: snapshot.nodes,
    notes: prev ? carryNotes(prev.review, snapshot.nodes) : [],
  });
}
