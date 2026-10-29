import { lstatSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { HTML_NAME, parseStamp, stamp } from './output-path.js';

const DAY_MS = 86_400_000;

interface PruneOptions {
  keep: number;
  maxAgeDays: number;
  now: Date;
  replaceSlug?: string;
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
  const files = names
    .map((name) => ({ name, m: HTML_NAME.exec(name) }))
    .filter((f): f is { name: string; m: RegExpExecArray } => f.m !== null)
    .map(({ name, m }) => ({ name, stamp: m[1]!, slug: m[2]! }))
    .sort((a, b) => b.stamp.localeCompare(a.stamp));

  const doomed = new Set<string>();
  // Files stamped `now` are the one this render just wrote: never delete them.
  for (const f of files) if (f.slug === opts.replaceSlug && f.stamp < current) doomed.add(f.name);
  const cutoff = opts.now.getTime() - opts.maxAgeDays * DAY_MS;
  files
    .filter((f) => !doomed.has(f.name))
    .forEach((f, i) => {
      if (f.stamp !== current && i >= opts.keep && parseStamp(f.stamp).getTime() < cutoff) doomed.add(f.name);
    });

  const deleted: string[] = [];
  for (const name of doomed) {
    const file = join(dir, name);
    try {
      rmSync(file);
      deleted.push(file);
    } catch {
      // Already gone or not removable: skip it.
    }
  }
  return deleted;
}
