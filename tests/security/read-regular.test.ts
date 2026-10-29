import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readRegularFile } from '../../src/read-regular.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'codechart-read-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const posix = process.platform !== 'win32';

describe('readRegularFile', () => {
  it('reads a regular file; accept sees its stats; false skips the read', () => {
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'hello');
    let size = -1;
    expect(readRegularFile(f, (st) => ((size = st.size), true))).toBe('hello');
    expect(size).toBe(5);
    expect(readRegularFile(f, () => false)).toBeUndefined();
    writeFileSync(f, '');
    expect(readRegularFile(f, () => true)).toBe('');
  });

  it('reads at most the size that was checked, even if the file grows meanwhile', () => {
    const f = join(dir, 'grow.txt');
    writeFileSync(f, 'checked');
    expect(readRegularFile(f, () => (appendFileSync(f, ' and then a lot more'), true))).toBe('checked');
  });

  it.runIf(posix)('refuses a symlink in place of the file (O_NOFOLLOW)', () => {
    const target = join(dir, 'secret.txt');
    writeFileSync(target, 'secret');
    const link = join(dir, 'link.txt');
    symlinkSync(target, link);
    let called = false;
    expect(() => readRegularFile(link, () => (called = true))).toThrow(/ELOOP|EMLINK|symbolic/i);
    expect(called).toBe(false);
  });

  it.runIf(posix)('opens a FIFO without blocking and lets accept reject it', () => {
    const fifo = join(dir, 'pipe');
    execFileSync('mkfifo', [fifo]);
    let regular: boolean | undefined;
    expect(readRegularFile(fifo, (st) => ((regular = st.isFile()), false))).toBeUndefined();
    expect(regular).toBe(false);
  });
});
