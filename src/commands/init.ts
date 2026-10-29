import { join } from 'node:path';
import { Command } from 'commander';
import { packageFile } from '../assets.js';
import { findRepoRoot } from '../config/load.js';
import type { CommandOptions } from '../program.js';
import { copyFiles } from './copy-file.js';

export function initCommand(opts: CommandOptions): Command {
  return new Command('init')
    .description('write a commented starter .codechart.yaml at the git root')
    .option('--force', 'overwrite an existing .codechart.yaml')
    .action((o: { force?: boolean }) => {
      const root = findRepoRoot(opts.cwd ?? process.cwd());
      if (!root) {
        opts.stderr('codechart: not a git repository\n');
        process.exitCode = 1;
        return;
      }
      copyFiles([{ source: packageFile('templates/codechart.yaml'), target: join(root, '.codechart.yaml') }], o.force === true, opts);
    });
}
