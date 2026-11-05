import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CommandOptions } from '../program.js';
import { readRegularFile } from '../read-regular.js';

const isSymlink = (path: string) => lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() === true;

export function copyFiles(pairs: { source: string; target: string }[], force: boolean, opts: CommandOptions): boolean {
  try {
    const link = force ? undefined : pairs.find(({ target }) => isSymlink(target));
    if (link) {
      opts.stderr(`codechart: ${link.target}: is a symlink (use --force to replace it)\n`);
      process.exitCode = 1;
      return false;
    }
    const conflict = force ? undefined : pairs.find(({ target }) => existsSync(target));
    if (conflict) {
      opts.stderr(`exists: ${conflict.target} (use --force)\n`);
      process.exitCode = 1;
      return false;
    }
    for (const { source, target } of pairs) {
      mkdirSync(dirname(target), { recursive: true });
      if (force && isSymlink(target)) unlinkSync(target);
      copyFileSync(source, target, force ? 0 : constants.COPYFILE_EXCL);
      opts.stdout(`wrote ${target}\n`);
    }
    return true;
  } catch (e) {
    opts.stderr(`codechart: ${(e as Error).message}\n`);
    process.exitCode = 1;
    return false;
  }
}

// Errors such as ENOTDIR count as "not installed" so copyFiles reports them.
export const hasAny = (paths: string[]) =>
  paths.some((p) => {
    try {
      return lstatSync(p, { throwIfNoEntry: false }) !== undefined;
    } catch {
      return false;
    }
  });

export type Pair = { source: string; target: string };

export const sameFile = ({ source, target }: Pair) => {
  try {
    return readRegularFile(target, (st) => st.isFile()) === readFileSync(source, 'utf8');
  } catch {
    return false;
  }
};

// An older copy of ours is updated; anything else there needs --force. True when the targets end up holding this version.
export function installPairs(pairs: Pair[], where: string, who: string, ours: () => boolean, force: boolean, opts: CommandOptions): boolean {
  let update = force;
  if (!force && hasAny(pairs.map((p) => p.target))) {
    if (pairs.every(sameFile)) {
      opts.stdout(`up to date for ${who}: ${where}\n`);
      return true;
    }
    let mine: boolean;
    try {
      mine = ours();
    } catch (e) {
      opts.stderr(`codechart: ${(e as Error).message}\n`);
      process.exitCode = 1;
      return false;
    }
    if (!mine) {
      opts.stdout(`already installed for ${who}: ${where} (--force to update)\n`);
      return false;
    }
    update = true;
  }
  if (!copyFiles(pairs, update, { ...opts, stdout: () => {} })) return false;
  opts.stdout(`${update && !force ? 'updated' : 'installed'} for ${who}: ${where}\n`);
  return true;
}
