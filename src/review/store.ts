import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

export const writeReview = (file: string, review: Review): void => writeFileSync(file, `${JSON.stringify(review, null, 2)}\n`, { mode: 0o600 });

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
