import { lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { packageFile } from '../assets.js';
import type { CommandOptions } from '../program.js';
import { AGENTS, isCodechartSkill } from './agents.js';
import { removeClaudeHooks, removeReminder } from './nudges.js';
import { pluginFile, removePlugin } from './opencode-plugin.js';

/** Deletes only the skill's own files, and the folder if that empties it. */
function removeSkill(dir: string, files: string[]): string | undefined {
  const st = lstatSync(dir, { throwIfNoEntry: false });
  if (!st) return undefined;
  if (!st.isDirectory()) return `left ${dir}: not a folder`;
  if (!isCodechartSkill(dir)) return `left ${dir}: not the codechart skill`;
  for (const f of files) if (lstatSync(join(dir, f), { throwIfNoEntry: false })?.isFile()) unlinkSync(join(dir, f));
  if (readdirSync(dir).length > 0) return `removed skill files from ${dir} (kept your other files there)`;
  rmdirSync(dir);
  return `removed skill: ${dir}`;
}

function pluginLine(file: string): string | undefined {
  const r = removePlugin(file);
  if (r === 'foreign') return `left ${file}: not the codechart plugin`;
  return r === 'removed' ? `removed plugin: ${file}` : undefined;
}

export function uninstallCommand(opts: CommandOptions): Command {
  return new Command('uninstall')
    .description('remove what install-skill added (all of it unless flags pick some); run before npm uninstall -g codechart')
    .option('--skill', 'remove the skill from every agent folder')
    .option('--reminder', "remove the reminder line from agents' instructions files")
    .option('--hook', 'remove the codechart hooks from ~/.claude/settings.json')
    .option('--plugin', 'remove the codechart plugin file from the OpenCode plugins folder')
    .action((o: { skill?: boolean; reminder?: boolean; hook?: boolean; plugin?: boolean }) => {
      const home = opts.home ?? homedir();
      const all = !o.skill && !o.reminder && !o.hook && !o.plugin;
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
      if (all || o.plugin) {
        const file = pluginFile(home, opts.env ?? process.env);
        step(() => pluginLine(file));
      }
      if (!did && process.exitCode !== 1) opts.stdout('nothing to remove\n');
    });
}
