import { lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { packageFile } from '../assets.js';
import type { CommandOptions } from '../program.js';
import { readState, skillDirs, writeState } from '../update/check.js';
import { agentsFor, isCodechartSkill, legacyAgentsFor } from './agents.js';
import { removeClaudeHooks, removeReminder } from './nudges.js';
import { pluginFile, removePlugin } from './opencode-plugin.js';
import { cacheDirOf } from './update.js';

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

/** The skill copies `install-skill --dir` recorded in the update state; the ones removed are forgotten. */
function removeRecordedSkills(files: string[], opts: CommandOptions, step: (run: () => string | undefined) => void): undefined {
  const cacheDir = cacheDirOf(opts);
  const state = readState(cacheDir);
  const recorded = skillDirs(state);
  const gone = new Set<string>();
  for (const dir of recorded) {
    step(() => {
      const line = removeSkill(dir, files);
      if (!line?.startsWith('left ')) gone.add(dir);
      return line;
    });
  }
  if (gone.size) writeState(cacheDir, { ...state, skillDirs: recorded.filter((d) => !gone.has(d)) });
  return undefined;
}

const withLegacy = (opts: CommandOptions) => [...agentsFor(opts.env ?? process.env), ...legacyAgentsFor(opts.env ?? process.env)];

function removeSkills(home: string, opts: CommandOptions, step: (run: () => string | undefined) => void): void {
  const files = readdirSync(packageFile('skills/codechart'));
  for (const folder of new Set(withLegacy(opts).flatMap((a) => [a.skills, ...a.reads]))) step(() => removeSkill(join(resolve(home, folder), 'codechart'), files));
  step(() => removeRecordedSkills(files, opts, step));
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
      if (all || o.skill) removeSkills(home, opts, step);
      if (all || o.reminder) {
        for (const a of withLegacy(opts)) {
          if (!a.instructions) continue;
          const file = resolve(home, a.instructions);
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
