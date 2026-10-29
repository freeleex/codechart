import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { packageFile } from '../assets.js';
import type { CommandOptions } from '../program.js';
import { AGENTS, skillFolders } from './agents.js';
import { copyFiles } from './copy-file.js';
import { terminalPicker } from './picker.js';

const NAMES = AGENTS.map((a) => a.name).join(', ');

const terminalChoose = () => (process.stdin.isTTY && process.stdout.isTTY ? terminalPicker : undefined);

// Errors such as ENOTDIR count as "not installed" so copyFiles reports them.
const hasAny = (paths: string[]) =>
  paths.some((p) => {
    try {
      return lstatSync(p, { throwIfNoEntry: false }) !== undefined;
    } catch {
      return false;
    }
  });

export function installSkillCommand(opts: CommandOptions): Command {
  return new Command('install-skill')
    .description('install the skill for the agents found in your home folder (or --agent / --dir)')
    .option('--agent <names...>', `install for these agents: ${NAMES}`)
    .option('--dir <path>', 'install into this skills folder')
    .option('--force', 'overwrite an existing install')
    .action(async (o: { agent?: string[]; dir?: string; force?: boolean }) => {
      const home = opts.home ?? homedir();
      const names = o.agent?.flatMap((n) => n.split(',')).map((n) => n.trim().toLowerCase()).filter(Boolean);
      const unknown = names?.find((n) => !AGENTS.some((a) => a.name === n));
      if (unknown !== undefined) {
        opts.stderr(`codechart: unknown agent '${unknown}' (known: ${NAMES})\n`);
        process.exitCode = 1;
        return;
      }
      let agents = names
        ? AGENTS.filter((a) => names.includes(a.name))
        : o.dir === undefined
          ? AGENTS.filter((a) => existsSync(join(home, a.home)))
          : [];
      if (agents.length === 0 && o.dir === undefined) {
        opts.stderr(`codechart: no agent found in ${home}; use --agent <name> (${NAMES}) or --dir <path>\n`);
        process.exitCode = 1;
        return;
      }
      if (!names && agents.length > 0) {
        const choose = opts.choose ?? terminalChoose();
        if (choose && agents.length > 1) {
          const found = agents;
          const picked = await choose(
            'Install the codechart skill for:',
            found.map((a) => ({ label: a.label, hint: `~/${a.skills}` })),
          );
          if (picked === undefined) {
            opts.stderr('codechart: cancelled, nothing installed\n');
            process.exitCode = 1;
            return;
          }
          if (picked.length === 0) {
            opts.stdout('nothing selected, nothing installed\n');
            return;
          }
          agents = picked.map((i) => found[i]!);
        } else {
          opts.stdout(`agents: ${agents.map((a) => a.label).join(', ')}\n`);
        }
      }
      const targets = skillFolders(agents).map((g) => ({
        dir: join(home, g.folder, 'codechart'),
        who: g.agents.map((a) => a.label).join(', '),
      }));
      if (o.dir !== undefined) targets.push({ dir: join(resolve(opts.cwd ?? process.cwd(), o.dir), 'codechart'), who: 'your folder' });
      // SKILL.md first; it links to the other files.
      const files = readdirSync(packageFile('skills/codechart')).sort((a, b) => Number(b === 'SKILL.md') - Number(a === 'SKILL.md'));
      for (const { dir, who } of targets) {
        const pairs = files.map((f) => ({ source: packageFile(`skills/codechart/${f}`), target: join(dir, f) }));
        if (o.force !== true && hasAny(pairs.map((p) => p.target))) {
          opts.stdout(`already installed for ${who}: ${dir} (--force to update)\n`);
          continue;
        }
        if (copyFiles(pairs, o.force === true, { ...opts, stdout: () => {} })) opts.stdout(`installed for ${who}: ${dir}\n`);
      }
    });
}
