import { accessSync, constants, existsSync, lstatSync, statSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import type { CommandOptions } from '../program.js';
import { currentVersion, isNewer, readState } from '../update/check.js';
import { AGENTS, isCodechartSkill, skillFolders, type AgentPreset } from './agents.js';
import { installCopy, skillFiles, skillIsCurrent } from './install-skill.js';
import { addReminder, claudeHookEvents, installClaudeHooks, reminderState } from './nudges.js';
import { opencodeConfigFile, pinPlugin, pluginSpec, pluginSpecs } from './opencode-plugin.js';
import { pluginBlocker } from './opencode-version.js';
import { cacheDirOf, runUpdate } from './update.js';

export interface Item {
  level: 'ok' | 'warn' | 'bad';
  text: string;
  /** The command that fixes a ✗ line. */
  fix?: string;
  /** Repeats a line shown under an earlier agent: not counted again. */
  same?: boolean;
  /** What `doctor --fix` does for it; none when only the user can. */
  run?: () => void | Promise<void>;
}

export interface Section {
  title: string;
  items: Item[];
  /** Fixed before other sections: the rest depends on it. */
  first?: boolean;
}

/** A file (symlinks followed) a shell could run: on POSIX with an execute bit, on Windows any file with a PATHEXT name. */
const runnable = (win: boolean) => (p: string) => {
  try {
    if (!statSync(p).isFile()) return false;
    if (!win) accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** The first `codechart` on PATH, as a shell would find it. */
export function findOnPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform, usable: (p: string) => boolean = runnable(platform === 'win32')): string | undefined {
  const win = platform === 'win32';
  const dirs = (win ? (env.PATH ?? env.Path ?? '') : (env.PATH ?? '')).split(win ? ';' : ':');
  const names = win ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => `codechart${e.toLowerCase()}`) : ['codechart'];
  for (const raw of dirs) {
    const dir = win ? raw.replace(/^"(.*)"$/, '$1') : raw;
    if (!dir) continue;
    for (const name of names) {
      const file = (win ? win32 : posix).join(dir, name);
      if (usable(file)) return file;
    }
  }
  return undefined;
}

const present = (p: string) => {
  try {
    return lstatSync(p, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return false;
  }
};

const ours = (dir: string) => {
  try {
    return isCodechartSkill(dir);
  } catch {
    return false;
  }
};

/** Skill folders already reported, by the agent that was first to show them. */
type Seen = Map<string, string>;

/** A ✗ about folders: each is reported once, under the first agent that reads it. */
function skillProblem(a: AgentPreset, dirs: string[], seen: Seen, item: Item): Item {
  const fresh = dirs.filter((d) => !seen.has(d));
  const owner = seen.get(dirs.find((d) => seen.has(d)) ?? '');
  for (const d of fresh) seen.set(d, a.label);
  return fresh.length ? item : { level: 'bad', text: `skill: same copy as ${owner}`, same: true };
}

function skillItem(a: AgentPreset, target: string, home: string, files: string[], opts: CommandOptions, seen: Seen): Item {
  const copies = [...new Set([a.skills, ...a.reads])].map((f) => join(home, f, 'codechart')).filter(present);
  const own = copies.filter(ours);
  const install = `codechart install-skill --agent ${a.name}`;
  // The agent may load any folder it reads, so one old copy is a fault even beside a current one.
  const stale = own.filter((d) => !skillIsCurrent(d, files));
  if (own.length && !stale.length) return { level: 'ok', text: `skill: ${own.join(', ')} (current)` };
  if (stale.length) {
    const fresh = stale.filter((d) => !seen.has(d));
    return skillProblem(a, stale, seen, {
      level: 'bad',
      text: `skill: outdated at ${fresh.join(', ')}`,
      fix: install,
      run: () => void fresh.forEach((d) => installCopy(d, a.label, files, false, opts)),
    });
  }
  if (copies.length) {
    return skillProblem(a, copies, seen, { level: 'bad', text: `skill: ${copies[0]} is not the codechart skill (left alone: move it aside first)`, fix: install });
  }
  const dir = join(home, target, 'codechart');
  return skillProblem(a, [dir], seen, { level: 'bad', text: `skill: missing (${dir})`, fix: install, run: () => void installCopy(dir, a.label, files, false, opts) });
}

function reminderItem(a: AgentPreset & { instructions: string }, home: string, opts: CommandOptions): Item {
  const file = join(home, a.instructions);
  const state = reminderState(file);
  if (state === 'present') return { level: 'ok', text: `reminder: ${file}` };
  const fix = `codechart install-skill --agent ${a.name} --reminder`;
  // A missing one may be an opt-out; only an outdated one is a fault.
  if (state === 'missing') return { level: 'warn', text: `reminder: missing in ${file}`, fix };
  return { level: 'bad', text: `reminder: outdated in ${file}`, fix, run: () => opts.stdout(`reminder ${addReminder(file)}: ${file}\n`) };
}

function hookItem(home: string, opts: CommandOptions): Item {
  const file = join(home, '.claude', 'settings.json');
  let state: ReturnType<typeof claudeHookEvents>;
  try {
    state = claudeHookEvents(file);
  } catch (e) {
    return { level: 'bad', text: `hook: ${(e as Error).message}` };
  }
  if (state.ok.length === 2) return { level: 'ok', text: `hook: Stop and prompt hooks in ${file}` };
  const fix = 'codechart install-skill --agent claude --hook';
  if (!state.ok.length && !state.wrong.length) return { level: 'warn', text: `hook: missing in ${file}`, fix };
  const problems = ['Stop', 'UserPromptSubmit']
    .filter((e) => !state.ok.includes(e))
    .map((e) => `${e} ${state.wrong.includes(e) ? 'runs the wrong command' : 'missing'}`);
  return {
    level: 'bad',
    text: `hook: ${problems.join(', ')} in ${file}`,
    fix,
    run: () => opts.stdout(installClaudeHooks(file) === 'added' ? `hook added: ${file}\n` : `hook already in ${file}\n`),
  };
}

function pluginItem(home: string, opts: CommandOptions): Item {
  const file = opencodeConfigFile(home);
  const want = pluginSpec(currentVersion());
  let specs: string[];
  try {
    specs = pluginSpecs(file);
  } catch (e) {
    return { level: 'bad', text: `plugin: ${(e as Error).message}` };
  }
  if (specs.length === 1 && specs[0] === want) return { level: 'ok', text: `plugin: ${want} in ${file}` };
  const blocker = pluginBlocker(opts, home);
  if (blocker) return { level: 'warn', text: `plugin: skipped, ${blocker}` };
  if (!specs.length) return { level: 'warn', text: `plugin: not added to ${file}`, fix: 'codechart install-skill --agent opencode --plugin' };
  const pins = specs.map((s) => (s.includes('@') ? `pinned to ${s.slice(s.indexOf('@') + 1)}` : 'not pinned'));
  return {
    level: 'bad',
    text: `plugin: ${pins.join(', ')}, this codechart is ${currentVersion()} in ${file}`,
    fix: 'codechart install-skill --agent opencode',
    run: () => opts.stdout(`plugin ${pinPlugin(file, currentVersion())}: ${want} in ${file}\n`),
  };
}

function agentSection(a: AgentPreset, target: string, home: string, files: string[], opts: CommandOptions, seen: Seen): Section {
  const items = [skillItem(a, target, home, files, opts, seen)];
  if (a.instructions) items.push(reminderItem({ ...a, instructions: a.instructions }, home, opts));
  if (a.name === 'claude') items.push(hookItem(home, opts));
  else if (a.name === 'opencode') items.push(pluginItem(home, opts));
  else items.push({ level: 'warn', text: `hook: no codechart hook for ${a.label} yet` });
  return { title: a.label, items };
}

function cliSection(opts: CommandOptions): Section {
  const items: Item[] = [];
  const found = findOnPath(opts.env ?? process.env);
  items.push(
    found
      ? { level: 'ok', text: `on PATH: ${found}` }
      : { level: 'bad', text: "not on PATH, so agents can't run it", fix: 'npm i -g codechart' },
  );
  const current = currentVersion();
  const latest = readState(cacheDirOf(opts)).latest;
  if (latest && isNewer(latest, current)) {
    items.push({ level: 'bad', text: `version ${current}, npm has ${latest}`, fix: 'codechart update', run: () => runUpdate({}, opts) });
  } else {
    items.push({ level: 'ok', text: `version ${current}${latest ? ' (newest known)' : ' (npm not checked yet)'}` });
  }
  return { title: 'codechart CLI', items, first: true };
}

/** Every check, from what is on disk; nothing is changed and nothing goes online. */
export function runChecks(home: string, opts: CommandOptions): Section[] {
  const agents = AGENTS.filter((a) => existsSync(join(home, a.home)));
  const files = skillFiles();
  const folders = skillFolders(agents);
  const seen: Seen = new Map();
  const sections = agents.map((a) => agentSection(a, folders.find((g) => g.agents.includes(a))!.folder, home, files, opts, seen));
  if (!agents.length) sections.push({ title: 'Agents', items: [{ level: 'bad', text: `no agent found in ${home}`, fix: 'codechart install-skill --agent <name>' }] });
  return [...sections, cliSection(opts)];
}
