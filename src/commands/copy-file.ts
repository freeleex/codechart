import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CommandOptions } from '../program.js';

const isSymlink = (path: string) => lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() === true;

export function copyFiles(pairs: { source: string; target: string }[], force: boolean, opts: CommandOptions): void {
  try {
    const link = force ? undefined : pairs.find(({ target }) => isSymlink(target));
    if (link) {
      opts.stderr(`codechart: ${link.target}: is a symlink (use --force to replace it)\n`);
      process.exitCode = 1;
      return;
    }
    const conflict = force ? undefined : pairs.find(({ target }) => existsSync(target));
    if (conflict) {
      opts.stderr(`exists: ${conflict.target} (use --force)\n`);
      process.exitCode = 1;
      return;
    }
    for (const { source, target } of pairs) {
      mkdirSync(dirname(target), { recursive: true });
      if (force && isSymlink(target)) unlinkSync(target);
      copyFileSync(source, target, force ? 0 : constants.COPYFILE_EXCL);
      opts.stdout(`wrote ${target}\n`);
    }
  } catch (e) {
    opts.stderr(`codechart: ${(e as Error).message}\n`);
    process.exitCode = 1;
  }
}
