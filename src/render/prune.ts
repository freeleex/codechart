import { lstatSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readReview } from '../review/store.js';
import { HTML_NAME, parseStamp, REVIEW_NAME, stamp } from './output-path.js';

const DAY_MS = 86_400_000;
const BUSINESS_KEEP_DAYS = 30;

interface PruneOptions {
  keep: number;
  maxAgeDays: number;
  now: Date;
  replaceSlug?: string;
  /** With `replaceSlug`: only renders drawn on this branch are replaced; a page with no review file to say is. */
  replaceBranch?: string;
  /** This render wrote no page: it replaces older review files that have none, and leaves pages alone. */
  pageless?: boolean;
}

/** One render: its page, its review file, or both. */
interface Entry {
  stamp: string;
  slug: string;
  page?: string;
  review?: string;
}

function entriesOf(names: string[]): Entry[] {
  const byBase = new Map<string, Entry>();
  const entry = (base: string): Entry => {
    if (!byBase.has(base)) byBase.set(base, { stamp: base.slice(0, 15), slug: base.slice(16) });
    return byBase.get(base)!;
  };
  for (const name of names) {
    const page = HTML_NAME.exec(name);
    if (page) entry(`${page[1]}-${page[2]}`).page = name;
    const review = REVIEW_NAME.exec(name);
    if (review) entry(review[1]!).review = name;
  }
  return [...byBase.values()].sort((a, b) => b.stamp.localeCompare(a.stamp));
}

function onBranch(dir: string, e: Entry, branch: string | undefined): boolean {
  if (branch === undefined || !e.review) return true;
  const review = readReview(join(dir, e.review));
  return !review || review.change.branch === branch;
}

const remove = (file: string): boolean => {
  try {
    rmSync(file);
    return true;
  } catch {
    return false; // Already gone or not removable: skip it.
  }
};

/** The owner may reply days after getting a business page, so its review file outlives the page. */
const retained = (e: Entry, now: Date): boolean => e.slug.endsWith('.business') && now.getTime() - parseStamp(e.stamp).getTime() < BUSINESS_KEEP_DAYS * DAY_MS;

/** A review file whose page was recorded and is gone, or that can't be read, is removed. One written without a page stays. */
function sweepReviews(dir: string, entries: Entry[], now: Date): void {
  for (const e of entries) {
    if (!e.review || e.page || retained(e, now)) continue;
    const review = readReview(join(dir, e.review));
    if (!review || review.change.html !== undefined) remove(join(dir, e.review));
  }
}

// Never throws: cleanup must not fail a render.
export function pruneHtml(dir: string, opts: PruneOptions): string[] {
  let names: string[];
  try {
    if (lstatSync(dir).isSymbolicLink()) return [];
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const current = stamp(opts.now);
  const entries = entriesOf(names);
  const doomed = new Set<Entry>();
  // Files stamped `now` are the one this render just wrote: never delete them.
  for (const e of entries) {
    if (e.slug === opts.replaceSlug && e.stamp < current && onBranch(dir, e, opts.replaceBranch) && !(opts.pageless && e.page)) doomed.add(e);
  }
  const cutoff = opts.now.getTime() - opts.maxAgeDays * DAY_MS;
  const aged = new Set<Entry>();
  entries
    .filter((e) => !doomed.has(e))
    .forEach((e, i) => {
      if (e.stamp !== current && i >= opts.keep && parseStamp(e.stamp).getTime() < cutoff) aged.add(e);
    });

  const deleted: string[] = [];
  for (const e of [...doomed, ...aged]) {
    if (e.page && remove(join(dir, e.page))) deleted.push(join(dir, e.page));
    if (e.review && !(aged.has(e) && retained(e, opts.now))) remove(join(dir, e.review));
  }
  sweepReviews(dir, entries.filter((e) => !doomed.has(e) && !aged.has(e)), opts.now);
  return deleted;
}
