import { posix } from 'node:path';
import type { SpecNode } from '../spec/schema.js';

/** Case, `_` and `-` dropped, so `total_amount` matches `totalAmount`. */
export const loose = (s: string) => s.toLowerCase().replace(/[_-]/g, '');

/** A dotted name's parts in order, so `access_logs.bucket` matches a nested `access_logs { bucket = … }` block. `text` is already loose. */
export function mentionsPath(text: string, name: string): boolean {
  let at = 0;
  for (const part of loose(name).split('.')) {
    const i = part ? text.indexOf(part, at) : -1;
    if (i < 0) return false;
    at = i + part.length;
  }
  return true;
}

const MIN_REF = 3;
const BARRELS = new Set(['index', '__init__', 'mod']);

/** One spelling per file, so `./src/a.ts` and `src\\a.ts` are `src/a.ts`. */
const samePath = (p: string) => posix.normalize(p.replace(/\\/g, '/'));

const noExt = (name: string) => (name.lastIndexOf('.') > 0 ? name.slice(0, name.lastIndexOf('.')) : name);

/**
 * The names an arrow's source file can use for its target: the target's file name (proves nothing inside one file),
 * the folder of an `index`-style file, the label (`module.vpc`, `store.FindOrder`) and a `Kind name` label's name.
 * Label-derived names under 3 characters are dropped, so `id` can't match inside other words.
 */
export function arrowNames(from: SpecNode, to: SpecNode): string[] {
  const parts = samePath(to.path ?? '').split('/');
  const file = noExt(parts.at(-1) ?? '');
  const sameFile = from.path !== undefined && to.path !== undefined && samePath(from.path) === samePath(to.path);
  const words = to.label.trim().split(/\s+/);
  const folder = !sameFile && parts.length > 1 && BARRELS.has(file) ? parts.at(-2)! : '';
  const derived = [folder, to.label.trim(), words.length > 1 ? words.at(-1)! : ''];
  const names = [sameFile ? '' : file, ...derived.filter((n) => loose(n).length >= MIN_REF)].filter(Boolean);
  return names.filter((n, i) => names.findIndex((m) => loose(m) === loose(n)) === i);
}
