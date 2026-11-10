import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import type { Config } from '../config/schema.js';

export const HTML_NAME = /^(\d{8}-\d{6})-([a-z0-9-]+(?:\.flow|\.business|\.release|\.explain)?)\.html$/;

export const REVIEW_NAME = /^(\d{8}-\d{6}-[a-z0-9-]+(?:\.flow|\.business|\.explain)?)\.review\.json$/;

/** The review notes file that sits next to a page. */
export const reviewFile = (html: string): string => html.replace(/\.html$/, '.review.json');

const pad = (n: number) => String(n).padStart(2, '0');

export function stamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function parseStamp(s: string): Date {
  const n = (from: number, to: number) => Number(s.slice(from, to));
  return new Date(n(0, 4), n(4, 6) - 1, n(6, 8), n(9, 11), n(11, 13), n(13, 15));
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  return slug || 'map';
}

// `.` can't come from a title, so a flow, business, release or explain file never collides with a map file.
export const fileSlug = (title: string, diagram: 'map' | 'flow' | 'business' | 'release' | 'explain'): string =>
  diagram === 'map' ? slugify(title) : `${slugify(title)}.${diagram}`;

/** The file name slug of an explain map. */
export const isExplainSlug = (slug: string): boolean => slug.endsWith('.explain');

export function htmlOutputPath(config: Config, repo: string, slug: string, now: Date): string {
  return join(config.web.outDir, repo, `${stamp(now)}-${slug}.html`);
}

// Readable name plus a path hash, so same-named repos never share (and prune) one folder.
export function repoFolder(root: string): string {
  return `${basename(root)}-${createHash('sha256').update(root).digest('hex').slice(0, 8)}`;
}
