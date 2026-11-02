import { lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { packageFile } from '../assets.js';
import type { CommandOptions } from '../program.js';
import { readRegularFile } from '../read-regular.js';
import { AGENTS } from './agents.js';
import { removeClaudeHooks, removeReminder } from './nudges.js';

/** Deletes only the skill's own files, and the folder if that empties it. */
function removeSkill(dir: string, files: string[]): string | undefined {
  const st = lstatSync(dir, { throwIfNoEntry: false });
  if (!st) return undefined;
  if (!st.isDirectory()) return `left ${dir}: not a folder`;
  const skill = join(dir, 'SKILL.md');
  const text = lstatSync(skill, { throwIfNoEntry: false })?.isFile() ? readRegularFile(skill, (s) => s.isFile()) : undefined;
  if (!text || !/^---\r?\n(?:.*\r?\n)*?name: codechart\r?\n/.test(text)) return `left ${dir}: not the codechart skill`;
  for (const f of files) if (lstatSync(join(dir, f), { throwIfNoEntry: false })?.isFile()) unlinkSync(join(dir, f));
  if (readdirSync(dir).length > 0) return `removed skill files from ${dir} (kept your other files there)`;
  rmdirSync(dir);
  return `removed skill: ${dir}`;
}

export function uninstallCommand(opts: CommandOptions): Command {
  return new Command('uninstall')
    .description('remove what install-skill added (all of it unless flags pick some); run before npm uninstall -g codechart')
    .option('--skill', 'remove the skill from every agent folder')
    .option('--reminder', "remove the reminder line from agents' instructions files")
    .option('--hook', 'remove the codechart hooks from ~/.claude/settings.json')
    .action((o: { skill?: boolean; reminder?: boolean; hook?: boolean }) => {
      const home = opts.home ?? homedir();
      const all = !o.skill && !o.reminder && !o.hook;
      let did = false;
      const step = (run: () => string | undefined) => {
        try {
          const line = run();
          if (line) {
            opts.stdout(`${line}\n`);
            did = true;
          }
        } catch (e) {
          opts.stderr(`codechart: ${(e as Error).message}\n`);
          process.exitCode = 1;
        }
      };
      if (all || o.skill) {
        const files = readdirSync(packageFile('skills/codechart'));
        for (const folder of new Set(AGENTS.flatMap((a) => [a.skills, ...a.reads]))) step(() => removeSkill(join(home, folder, 'codechart'), files));
      }
      if (all || o.reminder) {
        for (const a of AGENTS) {
          if (!a.instructions) continue;
          const file = join(home, a.instructions);
          step(() => (removeReminder(file) === 'removed' ? `removed reminder: ${file}` : undefined));
        }
      }
      if (all || o.hook) {
        const file = join(home, '.claude', 'settings.json');
        step(() => (removeClaudeHooks(file) === 'removed' ? `removed hook: ${file}` : undefined));
      }
      if (!did && process.exitCode !== 1) opts.stdout('nothing to remove\n');
    });
}
