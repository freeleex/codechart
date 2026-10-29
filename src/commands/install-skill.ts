import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { packageFile } from '../assets.js';
import type { CommandOptions } from '../program.js';
import { copyFiles } from './copy-file.js';

export function installSkillCommand(opts: CommandOptions): Command {
  return new Command('install-skill')
    .description('install the Claude Code skill into ~/.claude/skills/codechart/')
    .option('--force', 'overwrite an existing skill')
    .action((o: { force?: boolean }) => {
      const dir = join(opts.home ?? homedir(), '.claude', 'skills', 'codechart');
      // SKILL.md first; it links to the other files.
      const files = readdirSync(packageFile('skills/codechart')).sort((a, b) => Number(b === 'SKILL.md') - Number(a === 'SKILL.md'));
      const pairs = files.map((f) => ({ source: packageFile(`skills/codechart/${f}`), target: join(dir, f) }));
      copyFiles(pairs, o.force === true, opts);
    });
}
