import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { git, makeSandbox, removeSandbox, type Sandbox } from '../helpers/sandbox.js';

// A second hook process prunes at the same moment: its entries vanish between readdir and lstat or unlink.
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const enoent = (p: string) => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
  return {
    ...fs,
    readdirSync: ((dir: string, ...rest: unknown[]) => [...(fs.readdirSync as (...a: unknown[]) => string[])(dir, ...rest), 'gone-before-lstat.json', 'gone-before-unlink.json']) as typeof fs.readdirSync,
    lstatSync: ((p: string, o?: { throwIfNoEntry?: boolean }) => {
      if (p.endsWith('gone-before-lstat.json')) {
        if (o?.throwIfNoEntry === false) return undefined;
        throw enoent(p);
      }
      if (p.endsWith('gone-before-unlink.json')) return { isFile: () => true, mtimeMs: 0 };
      return (fs.lstatSync as (...a: unknown[]) => unknown)(p, o);
    }) as typeof fs.lstatSync,
    unlinkSync: ((p: string) => {
      if (p.endsWith('gone-before-unlink.json')) throw enoent(p);
      return fs.unlinkSync(p);
    }) as typeof fs.unlinkSync,
  };
});

const { saveSnapshot } = await import('../../src/commands/hook-core.js');

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox('hook-race', { git: 'init' });
  writeFileSync(join(sb.repo, 'a.txt'), 'a');
  git(sb.repo, 'add', '.');
  git(sb.repo, 'commit', '-q', '-m', 'init');
  writeFileSync(join(sb.repo, 'a.txt'), 'b');
});
afterEach(() => removeSandbox(sb.tmp));

describe('saveSnapshot while another hook prunes', () => {
  it('writes the snapshot although entries vanish mid-prune', () => {
    const dir = join(sb.tmp, 'turns');
    const file = join(dir, 's1.json');
    saveSnapshot(dir, file, sb.repo, new Date());
    expect(existsSync(file)).toBe(true);
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')).files)).toEqual(['a.txt']);
  });
});
