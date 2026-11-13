import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { packageFile } from '../assets.js';
import { loadConfig } from '../config/load.js';
import type { CommandOptions } from '../program.js';
import { rememberSkillDir } from '../update/check.js';
import { AGENTS, isCodechartSkill, skillFolders, type AgentPreset } from './agents.js';
import { hasAny, installPairs, sameFile } from './copy-file.js';
import { addReminder, installClaudeHooks } from './nudges.js';
import { installPlugin, pluginFile } from './opencode-plugin.js';
import { pluginBlocker } from './opencode-version.js';
import { terminalPicker } from './picker.js';

const NAMES = AGENTS.map((a) => a.name).join(', ');

const terminalChoose = () => (process.stdin.isTTY && process.stdout.isTTY ? terminalPicker : undefined);

/** The skill's files, SKILL.md first; it links to the other files. */
export const skillFiles = (): string[] => readdirSync(packageFile('skills/codechart')).sort((a, b) => Number(b === 'SKILL.md') - Number(a === 'SKILL.md'));

/** Whether `dir` holds every file of this version's skill, byte for byte. */
export const skillIsCurrent = (dir: string, files: string[]): boolean =>
  files.every((f) => sameFile({ source: packageFile(`skills/codechart/${f}`), target: join(dir, f) }));

interface Extras {
  reminder: boolean;
  hook: boolean;
  plugin: boolean;
}

interface Flags {
  agent?: string[];
  dir?: string;
  force?: boolean;
  reminder?: boolean;
  hook?: boolean;
  plugin?: boolean;
}

const hasClaude = (agents: AgentPreset[]) => agents.some((a) => a.name === 'claude');
const hasOpencode = (agents: AgentPreset[]) => agents.some((a) => a.name === 'opencode');

/** "Reminder, hook and plugin not added. Run with --reminder --hook --plugin to add them.", naming only `keys`. */
function notAddedLine(keys: (keyof Extras)[]): string {
  const words = keys.map((k, i) => (i === 0 ? `${k[0]!.toUpperCase()}${k.slice(1)}` : k));
  const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0];
  return `${list} not added. Run with ${keys.map((k) => `--${k}`).join(' ')} to add them.`;
}

async function chooseExtras(agents: AgentPreset[], opts: CommandOptions): Promise<Extras> {
  const choose = opts.choose ?? terminalChoose();
  const files = agents.flatMap((a) => (a.instructions ? [`~/${a.instructions}`] : []));
  const items: { key: keyof Extras; label: string; hint: string }[] = [];
  if (files.length) items.push({ key: 'reminder', label: 'Reminder line', hint: `use codechart for 3+ file changes → ${files.join(', ')}` });
  if (hasClaude(agents)) {
    items.push({ key: 'hook', label: 'Claude Code hook', hint: 'ask for a diagram when a turn changed 3+ files → ~/.claude/settings.json' });
  }
  if (hasOpencode(agents)) {
    items.push({ key: 'plugin', label: 'OpenCode plugin', hint: 'ask for a diagram when a turn changed 3+ files → ~/.config/opencode/plugins/codechart.js' });
  }
  if (items.length === 0) return { reminder: true, hook: hasClaude(agents), plugin: hasOpencode(agents) };
  // Off a terminal nobody can answer, and the extras edit global files: without --agent or a flag none are added.
  if (!choose) {
    opts.stdout(`${notAddedLine(items.map((i) => i.key))}\n`);
    return { reminder: false, hook: false, plugin: false };
  }
  const picked = await choose('Agents forget skills in long sessions; these help them remember codechart:', items, true);
  const keys = new Set((picked ?? []).map((i) => items[i]!.key));
  return { reminder: keys.has('reminder'), hook: keys.has('hook'), plugin: keys.has('plugin') };
}

// No flag: all, after asking in a terminal. --reminder/--hook/--plugin: only those. --no-reminder/--no-hook/--no-plugin: the rest.
async function pickExtras(o: Flags, agents: AgentPreset[], opts: CommandOptions): Promise<Extras> {
  const plugin = hasOpencode(agents);
  if (o.reminder === true || o.hook === true || o.plugin === true) return { reminder: o.reminder === true, hook: o.hook === true, plugin: o.plugin === true && plugin };
  if (o.reminder === undefined && o.hook === undefined && o.plugin === undefined && o.agent === undefined) return chooseExtras(agents, opts);
  return { reminder: o.reminder !== false, hook: o.hook !== false && hasClaude(agents), plugin: o.plugin !== false && plugin };
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
        const r = addReminder(file);
        return r === 'present' ? `reminder already in ${file}` : `reminder ${r}: ${file}`;
      });
    }
  }
  if (extras.hook) {
    const file = join(home, '.claude', 'settings.json');
    report('hook', () => (installClaudeHooks(file) === 'added' ? `hook added: ${file}` : `hook already in ${file}`));
  }
  if (extras.plugin) {
    const blocker = pluginBlocker(opts, home);
    if (blocker) opts.stdout(`OpenCode plugin skipped: ${blocker}\n`);
    else installPlugin(pluginFile(home, opts.env ?? process.env), force, opts);
  }
}

const YOUR_FOLDER = 'your folder';

/** So update refreshes a --dir copy too. */
function rememberOwn(installed: { dir: string; who: string }[], opts: CommandOptions): void {
  const own = installed.find((t) => t.who === YOUR_FOLDER);
  if (!own) return;
  try {
    rememberSkillDir(loadConfig({ cwd: opts.cwd ?? process.cwd(), home: opts.home, env: opts.env }).web.outDir, own.dir);
  } catch {
    // Only update misses it then.
  }
}

// An older codechart copy is updated so description fixes reach users; a folder that isn't ours needs --force.
// True when the folder ends up holding this version of the skill.
export function installCopy(dir: string, who: string, files: string[], force: boolean, opts: CommandOptions): boolean {
  const pairs = files.map((f) => ({ source: packageFile(`skills/codechart/${f}`), target: join(dir, f) }));
  return installPairs(pairs, dir, who, () => isCodechartSkill(dir), force, opts);
}

/** The agents to install for; undefined when the run ends here (nothing to install, or an error already reported). */
async function pickAgents(o: Flags, home: string, opts: CommandOptions): Promise<AgentPreset[] | undefined> {
  const names = o.agent?.flatMap((n) => n.split(',')).map((n) => n.trim().toLowerCase()).filter(Boolean);
  const unknown = names?.find((n) => !AGENTS.some((a) => a.name === n));
  if (unknown !== undefined) {
    opts.stderr(`codechart: unknown agent '${unknown}' (known: ${NAMES})\n`);
    process.exitCode = 2;
    return undefined;
  }
  let agents = names
    ? AGENTS.filter((a) => names.includes(a.name))
    : o.dir === undefined
      ? AGENTS.filter((a) => existsSync(join(home, a.home)))
      : [];
  if (agents.length === 0 && o.dir === undefined) {
    opts.stderr(`codechart: no agent found in ${home}; use --agent <name> (${NAMES}) or --dir <path>\n`);
    process.exitCode = 1;
    return undefined;
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
        return undefined;
      }
      if (picked.length === 0) {
        opts.stdout('nothing selected, nothing installed\n');
        return undefined;
      }
      agents = picked.map((i) => found[i]!);
    } else {
      opts.stdout(`agents: ${agents.map((a) => a.label).join(', ')}\n`);
    }
  }
  return agents;
}

function skillTargets(agents: AgentPreset[], home: string, files: string[], dir: string | undefined, cwd: string) {
  const groups = skillFolders(agents);
  // Earlier installs in other folders these agents read would go stale, so report or update them too.
  for (const folder of new Set(agents.flatMap((a) => [a.skills, ...a.reads]))) {
    if (groups.some((g) => g.folder === folder) || !hasAny(files.map((f) => join(home, folder, 'codechart', f)))) continue;
    groups.push({ folder, agents: agents.filter((a) => [a.skills, ...a.reads].includes(folder)) });
  }
  const targets = groups.map((g) => ({ dir: join(home, g.folder, 'codechart'), who: g.agents.map((a) => a.label).join(', '), agents: g.agents }));
  if (dir !== undefined) targets.push({ dir: join(resolve(cwd, dir), 'codechart'), who: YOUR_FOLDER, agents: [] });
  return targets;
}

export function installSkillCommand(opts: CommandOptions): Command {
  return new Command('install-skill')
    .description('install the skill for the agents found in your home folder (or --agent / --dir)')
    .option('--agent <names...>', `install for these agents: ${NAMES}`)
    .option('--dir <path>', 'install into this skills folder')
    .option('--force', 'overwrite an install that is not an older codechart copy')
    .option('--reminder', "only the reminder line in each agent's global instructions file (with --agent every helper is added, without it after asking in a terminal; off a terminal none)")
    .option('--no-reminder', 'skip the reminder line')
    .option('--hook', 'only the Claude Code hook that asks for a diagram after a turn that changed 3+ files without one')
    .option('--no-hook', 'skip the Claude Code hook')
    .option('--plugin', 'only the OpenCode plugin that asks for a diagram after a turn that changed 3+ files without one')
    .option('--no-plugin', 'skip the OpenCode plugin')
    .action(async (o: Flags) => {
      const home = opts.home ?? homedir();
      const picked = await pickAgents(o, home, opts);
      if (!picked) return;
      const files = skillFiles();
      const installed = skillTargets(picked, home, files, o.dir, opts.cwd ?? process.cwd()).filter((t) => installCopy(t.dir, t.who, files, o.force === true, opts));
      rememberOwn(installed, opts);
      // Reminder and hook only for agents that can load the skill they point to.
      const ready = new Set(installed.flatMap((t) => t.agents));
      const agents = picked.filter((a) => ready.has(a));
      if (agents.length) installExtras(await pickExtras(o, agents, opts), agents, home, o.force === true, opts);
    });
}
