import { existsSync, lstatSync } from 'node:fs';
import { delimiter, join, win32 } from 'node:path';
import type { CommandOptions } from '../program.js';
import { currentVersion, isNewer, readState } from '../update/check.js';
import { AGENTS, isCodechartSkill, skillFolders, type AgentPreset } from './agents.js';
import { installCopy, skillFiles, skillIsCurrent } from './install-skill.js';
import { addReminder, claudeHookEvents, installClaudeHooks, reminderState } from './nudges.js';
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
  const current = own.find((d) => skillIsCurrent(d, files));
  const install = `codechart install-skill --agent ${a.name}`;
  if (current) return { level: 'ok', text: `skill: ${current} (current)` };
  if (own.length) {
    const stale = own.filter((d) => !skillIsCurrent(d, files));
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
  let events: string[];
  try {
    events = claudeHookEvents(file);
  } catch (e) {
    return { level: 'bad', text: `hook: ${(e as Error).message}` };
  }
  if (events.length === 2) return { level: 'ok', text: `hook: Stop and prompt hooks in ${file}` };
  const fix = 'codechart install-skill --agent claude --hook';
  if (!events.length) return { level: 'warn', text: `hook: missing in ${file}`, fix };
  const missing = ['Stop', 'UserPromptSubmit'].filter((e) => !events.includes(e)).join(' and ');
  return {
    level: 'bad',
    text: `hook: ${missing} missing in ${file}`,
    fix,
    run: () => opts.stdout(installClaudeHooks(file) === 'added' ? `hook added: ${file}\n` : `hook already in ${file}\n`),
  };
}

function agentSection(a: AgentPreset, target: string, home: string, files: string[], opts: CommandOptions, seen: Seen): Section {
  const items = [skillItem(a, target, home, files, opts, seen)];
  if (a.instructions) items.push(reminderItem({ ...a, instructions: a.instructions }, home, opts));
  items.push(a.name === 'claude' ? hookItem(home, opts) : { level: 'warn', text: `hook: no codechart hook for ${a.label} yet` });
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
