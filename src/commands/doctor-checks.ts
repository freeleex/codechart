import { existsSync, lstatSync } from 'node:fs';
import { delimiter, join, win32 } from 'node:path';
import type { CommandOptions } from '../program.js';
import { currentVersion, isNewer, readState } from '../update/check.js';
import { AGENTS, isCodechartSkill, type AgentPreset } from './agents.js';
import { installCopy, skillFiles, skillIsCurrent } from './install-skill.js';
import { addReminder, claudeHookEvents, installClaudeHooks, reminderState } from './nudges.js';
import { cacheDirOf, runUpdate } from './update.js';

export interface Item {
  level: 'ok' | 'warn' | 'bad';
  text: string;
  /** The command that fixes a ✗ line. */
  fix?: string;
  /** What `doctor --fix` does for it; none when only the user can. */
  run?: () => void | Promise<void>;
}

export interface Section {
  title: string;
  items: Item[];
  /** Fixed before other sections: the rest depends on it. */
  first?: boolean;
}

/** The first `codechart` on PATH, as a shell would find it. */
export function findOnPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = existsSync): string | undefined {
  const win = platform === 'win32';
  const dirs = (win ? (env.PATH ?? env.Path ?? '') : (env.PATH ?? '')).split(win ? ';' : delimiter);
  const names = win ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => `codechart${e.toLowerCase()}`) : ['codechart'];
  for (const raw of dirs) {
    const dir = win ? raw.replace(/^"(.*)"$/, '$1') : raw;
    if (!dir) continue;
    for (const name of names) {
      const file = win ? win32.join(dir, name) : join(dir, name);
      if (exists(file)) return file;
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

function skillItem(a: AgentPreset, home: string, files: string[], opts: CommandOptions): Item {
  const copies = [...new Set([a.skills, ...a.reads])].map((f) => join(home, f, 'codechart')).filter(present);
  const own = copies.filter(ours);
  const current = own.find((d) => skillIsCurrent(d, files));
  const install = `codechart install-skill --agent ${a.name}`;
  if (current) return { level: 'ok', text: `skill: ${current} (current)` };
  if (own.length) {
    const stale = own.filter((d) => !skillIsCurrent(d, files));
    return {
      level: 'bad',
      text: `skill: outdated at ${stale.join(', ')}`,
      fix: install,
      run: () => void stale.forEach((d) => installCopy(d, a.label, files, false, opts)),
    };
  }
  if (copies.length) return { level: 'bad', text: `skill: ${copies[0]} is not the codechart skill (left alone: move it aside first)`, fix: install };
  const dir = join(home, a.skills, 'codechart');
  return { level: 'bad', text: `skill: missing (${dir})`, fix: install, run: () => void installCopy(dir, a.label, files, false, opts) };
}

function reminderItem(a: AgentPreset & { instructions: string }, home: string, opts: CommandOptions): Item {
  const file = join(home, a.instructions);
  const state = reminderState(file);
  if (state === 'present') return { level: 'ok', text: `reminder: ${file}` };
  return {
    level: 'bad',
    text: `reminder: ${state} in ${file}`,
    fix: `codechart install-skill --agent ${a.name} --reminder`,
    run: () => opts.stdout(`reminder ${addReminder(file)}: ${file}\n`),
  };
}

function hookItem(home: string, opts: CommandOptions): Item {
  const file = join(home, '.claude', 'settings.json');
  let events: string[];
  try {
    events = claudeHookEvents(file);
  } catch (e) {
    return { level: 'bad', text: `hook: ${(e as Error).message}` };
  }
  if (events.length === 2) return { level: 'ok', text: `hook: Stop and prompt hooks in ${file}` };
  const missing = ['Stop', 'UserPromptSubmit'].filter((e) => !events.includes(e)).join(' and ');
  return {
    level: 'bad',
    text: `hook: ${missing} missing in ${file}`,
    fix: 'codechart install-skill --agent claude --hook',
    run: () => opts.stdout(installClaudeHooks(file) === 'added' ? `hook added: ${file}\n` : `hook already in ${file}\n`),
  };
}

function agentSection(a: AgentPreset, home: string, files: string[], opts: CommandOptions): Section {
  const items = [skillItem(a, home, files, opts)];
  if (a.instructions) items.push(reminderItem({ ...a, instructions: a.instructions }, home, opts));
  items.push(a.name === 'claude' ? hookItem(home, opts) : { level: 'warn', text: `hook: none, ${a.label} has no hook support (the skill and reminder are all it gets)` });
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
  const sections = agents.map((a) => agentSection(a, home, files, opts));
  if (!agents.length) sections.push({ title: 'Agents', items: [{ level: 'bad', text: `no agent found in ${home}`, fix: 'codechart install-skill --agent <name>' }] });
  return [...sections, cliSection(opts)];
}
