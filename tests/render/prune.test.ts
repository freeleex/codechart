import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stamp } from '../../src/render/output-path.js';
import { pruneHtml } from '../../src/render/prune.js';

const DAY = 86_400_000;
const now = new Date(2026, 9, 28, 12, 0, 0);
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'codechart-prune-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function file(name: string): string {
  writeFileSync(join(dir, name), 'x');
  return join(dir, name);
}
function htmlAt(ago: number, slug: string): string {
  return file(`${stamp(new Date(now.getTime() - ago))}-${slug}.html`);
}
const opts = { keep: 20, maxAgeDays: 7, now };

describe('pruneHtml', () => {
  it('re-render same title -> earlier file for that slug deleted', () => {
    const old = htmlAt(60_000, 'teams');
    const other = htmlAt(60_000, 'other');
    const current = htmlAt(0, 'teams');
    expect(pruneHtml(dir, { ...opts, replaceSlug: 'teams' })).toEqual([old]);
    expect(existsSync(current)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });

  it('replaceSlug matches the whole slug, not a prefix', () => {
    const longer = htmlAt(60_000, 'teams-b');
    htmlAt(0, 'teams');
    expect(pruneHtml(dir, { ...opts, replaceSlug: 'teams' })).toEqual([]);
    expect(existsSync(longer)).toBe(true);
  });

  it('a flow slug only replaces flow files, a map slug only map files', () => {
    const map = htmlAt(60_000, 'checkout');
    const flowFile = htmlAt(60_000, 'checkout.flow');
    htmlAt(0, 'checkout.flow');
    expect(pruneHtml(dir, { ...opts, replaceSlug: 'checkout.flow' })).toEqual([flowFile]);
    expect(existsSync(map)).toBe(true);
  });

  it('25 files all older than 7 days -> newest 20 kept', () => {
    const files = Array.from({ length: 25 }, (_, i) => htmlAt(8 * DAY + i * 60_000, `s${i}`));
    const deleted = pruneHtml(dir, opts);
    expect(deleted.sort()).toEqual(files.slice(20).sort());
    expect(readdirSync(dir)).toHaveLength(20);
  });

  it('25 files all from today -> none deleted', () => {
    for (let i = 0; i < 25; i++) htmlAt(i * 60_000, `s${i}`);
    expect(pruneHtml(dir, opts)).toEqual([]);
    expect(readdirSync(dir)).toHaveLength(25);
  });

  it('non-matching files (notes.txt, other.html) are never deleted', () => {
    const keepers = [file('notes.txt'), file('other.html'), file('20200101-000000-x.htm'), file('20200101-000000-Upper.html')];
    for (let i = 0; i < 25; i++) htmlAt(30 * DAY + i * 60_000, `s${i}`);
    pruneHtml(dir, { ...opts, keep: 1 });
    for (const k of keepers) expect(existsSync(k)).toBe(true);
  });

  it('never deletes the file just written, even with keep 1, maxAgeDays 0 and future-stamped files', () => {
    const at = new Date(now.getTime() + 500);
    const current = file(`${stamp(at)}-cur.html`);
    htmlAt(-60_000, 'future-a');
    htmlAt(-120_000, 'future-b');
    pruneHtml(dir, { keep: 1, maxAgeDays: 0, now: at, replaceSlug: 'cur' });
    expect(existsSync(current)).toBe(true);
  });

  it('missing dir -> no throw, nothing deleted', () => {
    expect(pruneHtml(join(dir, 'nope'), opts)).toEqual([]);
  });
});
