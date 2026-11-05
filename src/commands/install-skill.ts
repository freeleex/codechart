import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { packageFile } from '../assets.js';
import type { CommandOptions } from '../program.js';
import { readRegularFile } from '../read-regular.js';
import { AGENTS, isCodechartSkill, skillFolders, type AgentPreset } from './agents.js';
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

type Pair = { source: string; target: string };

const sameFile = ({ source, target }: Pair) => {
  try {
    return readRegularFile(target, (st) => st.isFile()) === readFileSync(source, 'utf8');
  } catch {
    return false;
  }
};

interface Extras {
  reminder: boolean;
  hook: boolean;
}

interface Flags {
  agent?: string[];
  dir?: string;
  force?: boolean;
  reminder?: boolean;
  hook?: boolean;
}

const hasClaude = (agents: AgentPreset[]) => agents.some((a) => a.name === 'claude');

async function chooseExtras(agents: AgentPreset[], opts: CommandOptions): Promise<Extras> {
  const choose = opts.choose ?? terminalChoose();
  const files = agents.flatMap((a) => (a.instructions ? [`~/${a.instructions}`] : []));
  const items: { key: keyof Extras; label: string; hint: string }[] = [];
  if (files.length) items.push({ key: 'reminder', label: 'Reminder line', hint: `use codechart for 3+ file changes → ${files.join(', ')}` });
  if (hasClaude(agents)) {
    items.push({ key: 'hook', label: 'Claude Code hook', hint: 'ask for a diagram when a turn changed 3+ files → ~/.claude/settings.json' });
  }
  if (!choose || items.length === 0) return { reminder: true, hook: hasClaude(agents) };
  const picked = await choose('Agents forget skills in long sessions; these help them remember codechart:', items, true);
  const keys = new Set((picked ?? []).map((i) => items[i]!.key));
  return { reminder: keys.has('reminder'), hook: keys.has('hook') };
}

// No flag: both, after asking in a terminal. --reminder/--hook: only those. --no-reminder/--no-hook: the rest.
async function pickExtras(o: Flags, agents: AgentPreset[], opts: CommandOptions): Promise<Extras> {
  if (o.reminder === true || o.hook === true) return { reminder: o.reminder === true, hook: o.hook === true };
  if (o.reminder === undefined && o.hook === undefined && o.agent === undefined) return chooseExtras(agents, opts);
  return { reminder: o.reminder !== false, hook: o.hook !== false && hasClaude(agents) };
}

function installExtras(extras: Extras, agents: AgentPreset[], home: string, opts: CommandOptions) {
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
        const r = addReminder(file);
        return r === 'present' ? `reminder already in ${file}` : `reminder ${r}: ${file}`;
      });
    }
  }
  if (extras.hook) {
    const file = join(home, '.claude', 'settings.json');
    report('hook', () => (installClaudeHooks(file) === 'added' ? `hook added: ${file}` : `hook already in ${file}`));
  }
}

// An older codechart copy is updated so description fixes reach users; a folder that isn't ours needs --force.
// True when the folder ends up holding this version of the skill.
export function installCopy(dir: string, who: string, files: string[], force: boolean, opts: CommandOptions): boolean {
  const pairs = files.map((f) => ({ source: packageFile(`skills/codechart/${f}`), target: join(dir, f) }));
  let update = force;
  if (!force && hasAny(pairs.map((p) => p.target))) {
    if (pairs.every(sameFile)) {
      opts.stdout(`up to date for ${who}: ${dir}\n`);
      return true;
    }
    let ours: boolean;
    try {
      ours = isCodechartSkill(dir);
    } catch (e) {
      opts.stderr(`codechart: ${(e as Error).message}\n`);
      process.exitCode = 1;
      return false;
    }
    if (!ours) {
      opts.stdout(`already installed for ${who}: ${dir} (--force to update)\n`);
      return false;
    }
    update = true;
  }
  if (!copyFiles(pairs, update, { ...opts, stdout: () => {} })) return false;
  opts.stdout(`${update && !force ? 'updated' : 'installed'} for ${who}: ${dir}\n`);
  return true;
}

// complexity-ratchet: 40 -- install action picks agents and targets inline
// eslint-disable-next-line max-lines-per-function -- ratchet: install action picks agents and targets inline
export function installSkillCommand(opts: CommandOptions): Command {
  return new Command('install-skill')
    .description('install the skill for the agents found in your home folder (or --agent / --dir)')
    .option('--agent <names...>', `install for these agents: ${NAMES}`)
    .option('--dir <path>', 'install into this skills folder')
    .option('--force', 'overwrite an install that is not an older codechart copy')
    .option('--reminder', "only the reminder line in each agent's global instructions file (both extras are added by default)")
    .option('--no-reminder', 'skip the reminder line')
    .option('--hook', 'only the Claude Code hook that asks for a diagram after a turn that changed 3+ files without one')
    .option('--no-hook', 'skip the Claude Code hook')
    // eslint-disable-next-line complexity -- ratchet: install action picks agents and targets inline
    .action(async (o: Flags) => {
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
      const targets = groups.map((g) => ({ dir: join(home, g.folder, 'codechart'), who: g.agents.map((a) => a.label).join(', '), agents: g.agents }));
      if (o.dir !== undefined) targets.push({ dir: join(resolve(opts.cwd ?? process.cwd(), o.dir), 'codechart'), who: 'your folder', agents: [] });
      // Reminder and hook only for agents that can load the skill they point to.
      const ready = new Set(targets.flatMap((t) => (installCopy(t.dir, t.who, files, o.force === true, opts) ? t.agents : [])));
      agents = agents.filter((a) => ready.has(a));
      if (agents.length) installExtras(await pickExtras(o, agents, opts), agents, home, opts);
    });
}
