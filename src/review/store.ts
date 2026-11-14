import { createHash } from 'node:crypto';
import { closeSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REVIEW_NAME } from '../render/output-path.js';
import { carryNotes } from './carry.js';
import { reviewSchema, type Range, type Review, type ReviewNode } from './schema.js';

export interface Found {
  file: string;
  review: Review;
}

export interface ReviewSnapshot {
  kind: 'map' | 'flow' | 'business';
  title?: string;
  nodes: ReviewNode[];
  range?: Range;
  drift?: Review['drift'];
  edges?: Review['edges'];
  gaps?: string[];
  omitted?: string[];
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
  /** Replaces the wait between tries, so a test can act while the lock is held. */
  sleep?: (ms: number) => void;
}

const DEFAULT_LOCK: LockTimes = { waitMs: 2000, staleMs: 10_000 };

/** The lock of one map on one branch: the same name whichever timestamped review file is the current one. */
export const reviewLock = (dir: string, branch: string, slug: string): string => join(dir, `${slug}.${createHash('sha256').update(branch).digest('hex').slice(0, 16)}.lock`);

const sleep = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Runs `fn` holding `lock` (created exclusively): a second command waits its turn, a lock older than `staleMs` is a crashed one's and goes. */
function withLock<T>(lock: string, fn: () => T, { waitMs, staleMs, sleep: wait = sleep }: LockTimes): T {
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
    else wait(25);
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

/** The newest readable review file of this slug on this branch, as it is on disk now. */
const currentReview = (dir: string, branch: string, slug: string): Found | undefined => listReviews(dir, branch, 'all').find((f) => f.review.change.slug === slug);

/**
 * Read, change and write the review `found` names as one step, under its map's lock: the current file is looked up again
 * there, so a render that replaced `found.file` meanwhile gets the change, and notes saved meanwhile are not lost.
 */
export function updateReview(found: Found, change: (current: Review) => Review, times: LockTimes = DEFAULT_LOCK): Review {
  const dir = dirname(found.file);
  const { branch, slug } = found.review.change;
  return withLock(
    reviewLock(dir, branch, slug),
    () => {
      const current = currentReview(dir, branch, slug);
      if (!current) throw new Error(`The review notes in ${found.file} can't be read.`);
      const next = change(current.review);
      if (next !== current.review) writeReview(current.file, next);
      return next;
    },
    times,
  );
}

export type Which = 'tech' | 'business' | 'all';

/** The review files of `branch` in `dir`, newest page first: those of tech maps and flows, or `business` pages, or `all`. */
export function listReviews(dir: string, branch: string, which: Which = 'tech'): Found[] {
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
      return review && review.change.branch === branch && (which === 'all' || (review.change.kind === 'business') === (which === 'business')) ? [{ file: join(dir, n), review }] : [];
    });
}

/** Review files in `dir` that can't be read, newest first. */
function unreadableReviews(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => REVIEW_NAME.test(n))
      .sort()
      .reverse()
      .map((n) => join(dir, n))
      .filter((f) => readReview(f) === undefined);
  } catch {
    return [];
  }
}

const sameName = (r: Review, name: string): boolean => r.change.slug === name || (r.change.title ?? r.change.slug).toLowerCase() === name.toLowerCase();

/** The newest change on `branch`, or the one with this title or file name slug. `exact`: only a file name slug counts. `which`: tech maps and flows unless it says business pages. */
export function findChange(dir: string, branch: string, name?: string, exact = false, which: Which = 'tech'): Found {
  const found = listReviews(dir, branch, which).find((f) => name === undefined || (exact ? f.review.change.slug === name : sameName(f.review, name)));
  if (found) return found;
  const damaged = listReviews(dir, branch, which).length === 0 ? unreadableReviews(dir)[0] : undefined;
  if (damaged) throw new Error(`${damaged} can't be read (damaged): ask your agent to draw the map again.`);
  const where = branch ? ` on branch ${branch}` : ' here';
  throw new Error(name === undefined ? `No map to review${where} yet. Ask your agent for a map first.` : `No map called "${name}"${where}. Check the title, or ask your agent to draw it.`);
}

interface SaveOptions {
  dir: string;
  file: string;
  html?: string;
  slug: string;
  branch: string;
  now: Date;
  snapshot: ReviewSnapshot;
  /** Runs once the file is written, still holding the map's lock: that is where the previous render is removed. */
  afterWrite?: () => void;
  lock?: LockTimes;
}

/** Writes the review file `file`, taking over the notes of the last render of this slug on this branch. The map stays locked from reading those notes until `afterWrite` is done, so a note added meanwhile is not lost. */
export function saveReview(o: SaveOptions): void {
  withLock(reviewLock(o.dir, o.branch, o.slug), () => writeNew(o, currentReview(o.dir, o.branch, o.slug)?.review), o.lock ?? DEFAULT_LOCK);
}

function writeNew(o: SaveOptions, prev: Review | undefined): void {
  const { slug, branch, snapshot } = o;
  writeReview(o.file, {
    version: 1,
    change: { slug, ...(snapshot.title && { title: snapshot.title }), kind: snapshot.kind, branch, ...(o.html && { html: o.html }), renderedAt: o.now.toISOString(), ...(snapshot.range && { range: snapshot.range }) },
    nodes: snapshot.nodes,
    ...(snapshot.drift && { drift: snapshot.drift }),
    ...(snapshot.edges && { edges: snapshot.edges }),
    ...(snapshot.gaps && { gaps: snapshot.gaps }),
    ...(snapshot.omitted && { omitted: snapshot.omitted }),
    notes: prev ? carryNotes(prev, snapshot.nodes, snapshot) : [],
  });
  o.afterWrite?.();
}
