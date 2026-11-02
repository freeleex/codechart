import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { packageFile } from '../assets.js';
import type { CommandOptions } from '../program.js';
import { AGENTS, skillFolders, type AgentPreset } from './agents.js';
import { copyFiles } from './copy-file.js';
import { addReminder, installClaudeHooks } from './nudges.js';
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

interface Extras {
  reminder: boolean;
  hook: boolean;
}

async function chooseExtras(agents: AgentPreset[], opts: CommandOptions): Promise<Extras> {
  const choose = opts.choose ?? terminalChoose();
  const files = agents.flatMap((a) => (a.instructions ? [`~/${a.instructions}`] : []));
  const items: { key: keyof Extras; label: string; hint: string }[] = [];
  if (files.length) items.push({ key: 'reminder', label: 'Reminder line', hint: `use codechart for 3+ file changes → ${files.join(', ')}` });
  if (agents.some((a) => a.name === 'claude')) {
    items.push({ key: 'hook', label: 'Claude Code hook', hint: 'ask for a diagram when a turn changed 3+ files → ~/.claude/settings.json' });
  }
  if (!choose || items.length === 0) return { reminder: false, hook: false };
  const picked = await choose('Optional: help agents remember to use codechart', items, false);
  const keys = new Set((picked ?? []).map((i) => items[i]!.key));
  return { reminder: keys.has('reminder'), hook: keys.has('hook') };
}

function installExtras(extras: Extras, agents: AgentPreset[], home: string, force: boolean, opts: CommandOptions) {
  const report = (what: string, run: () => string) => {
    try {
      opts.stdout(`${run()}\n`);
    } catch (e) {
      opts.stderr(`codechart: ${what}: ${(e as Error).message}\n`);
      process.exitCode = 1;
    }
  };
  if (extras.reminder) {
    for (const a of agents) {
      if (!a.instructions) continue;
      const file = join(home, a.instructions);
      report('reminder', () => {
        const r = addReminder(file, force);
        return r === 'outdated' ? `reminder differs in ${file} (--force to update)` : r === 'present' ? `reminder already in ${file}` : `reminder ${r}: ${file}`;
      });
    }
  }
  if (extras.hook) {
    const file = join(home, '.claude', 'settings.json');
    report('hook', () => (installClaudeHooks(file) === 'added' ? `hook added: ${file}` : `hook already in ${file}`));
  }
}

export function installSkillCommand(opts: CommandOptions): Command {
  return new Command('install-skill')
    .description('install the skill for the agents found in your home folder (or --agent / --dir)')
    .option('--agent <names...>', `install for these agents: ${NAMES}`)
    .option('--dir <path>', 'install into this skills folder')
    .option('--force', 'overwrite an existing install')
    .option('--reminder', "add a one-line reminder to use codechart to each agent's global instructions file")
    .option('--hook', 'add a Claude Code hook that asks for a diagram after a turn that changed 3+ files without one')
    .action(async (o: { agent?: string[]; dir?: string; force?: boolean; reminder?: boolean; hook?: boolean }) => {
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
      // SKILL.md first; it links to the other files.
      const files = readdirSync(packageFile('skills/codechart')).sort((a, b) => Number(b === 'SKILL.md') - Number(a === 'SKILL.md'));
      const groups = skillFolders(agents);
      // Earlier installs in other folders these agents read would go stale, so report or update them too.
      for (const folder of new Set(agents.flatMap((a) => [a.skills, ...a.reads]))) {
        if (groups.some((g) => g.folder === folder) || !hasAny(files.map((f) => join(home, folder, 'codechart', f)))) continue;
        groups.push({ folder, agents: agents.filter((a) => [a.skills, ...a.reads].includes(folder)) });
      }
      const targets = groups.map((g) => ({ dir: join(home, g.folder, 'codechart'), who: g.agents.map((a) => a.label).join(', ') }));
      if (o.dir !== undefined) targets.push({ dir: join(resolve(opts.cwd ?? process.cwd(), o.dir), 'codechart'), who: 'your folder' });
      for (const { dir, who } of targets) {
        const pairs = files.map((f) => ({ source: packageFile(`skills/codechart/${f}`), target: join(dir, f) }));
        if (o.force !== true && hasAny(pairs.map((p) => p.target))) {
          opts.stdout(`already installed for ${who}: ${dir} (--force to update)\n`);
          continue;
        }
        if (copyFiles(pairs, o.force === true, { ...opts, stdout: () => {} })) opts.stdout(`installed for ${who}: ${dir}\n`);
      }
      // --agent means no questions; the extras then come only from their flags.
      const asked = !o.reminder && !o.hook && !names;
      const extras = asked ? await chooseExtras(agents, opts) : { reminder: o.reminder === true, hook: o.hook === true };
      installExtras(extras, agents, home, o.force === true, opts);
    });
}
