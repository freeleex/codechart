import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readRegularFile } from '../read-regular.js';

export const REMINDER =
  'Before summarizing or planning a change that touches 3+ files or adds behaviour with branches, use the codechart skill (skip it for small edits: typos, formatting, one-line fixes).';
const START = '<!-- codechart -->';
const END = '<!-- /codechart -->';
const BLOCK = `${START}\n${REMINDER}\n${END}`;

// Instruction and settings files are often symlinks into a dotfiles repo, so reads and writes go to the target.
function readRegular(file: string): { path: string; text?: string } {
  let path: string;
  try {
    path = realpathSync(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { path: file };
    throw e;
  }
  const text = readRegularFile(path, (st) => st.isFile());
  if (text === undefined) throw new Error(`${file}: not a regular file`);
  return { path, text };
}

function blockAt(text: string): [number, number] | undefined {
  const at = text.indexOf(START);
  const end = at < 0 ? -1 : text.indexOf(END, at);
  return end > at ? [at, end + END.length] : undefined;
}

/** Replaces an older reminder between codechart markers; a file without one is left alone. */
export function refreshReminder(file: string): 'updated' | 'present' | 'absent' {
  let text: string | undefined;
  try {
    text = readRegular(file).text;
  } catch {
    return 'absent';
  }
  return text !== undefined && blockAt(text) ? (addReminder(file) === 'updated' ? 'updated' : 'present') : 'absent';
}

/** Adds the reminder between codechart markers once; a different one between the markers is replaced. */
export function addReminder(file: string): 'added' | 'updated' | 'present' {
  const { path, text = '' } = readRegular(file);
  const block = blockAt(text);
  if (block) {
    if (text.slice(...block) === BLOCK) return 'present';
    writeFileSync(path, text.slice(0, block[0]) + BLOCK + text.slice(block[1]));
    return 'updated';
  }
  mkdirSync(dirname(path), { recursive: true });
  const gap = text === '' || text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(path, `${text}${gap}${BLOCK}\n`);
  return 'added';
}

/** How the reminder line in `file` looks, without touching it. */
export function reminderState(file: string): 'present' | 'outdated' | 'missing' {
  let text: string | undefined;
  try {
    text = readRegular(file).text;
  } catch {
    return 'missing';
  }
  const block = text === undefined ? undefined : blockAt(text);
  if (!text || !block) return 'missing';
  return text.slice(...block) === BLOCK ? 'present' : 'outdated';
}

/** Removes the reminder and the blank line added before it; the file stays, even when left empty. */
export function removeReminder(file: string): 'removed' | 'absent' {
  const { path, text } = readRegular(file);
  const block = text === undefined ? undefined : blockAt(text);
  if (!text || !block) return 'absent';
  const before = text.slice(0, block[0]).replace(/\n\n$/, '\n');
  const after = text.slice(block[1]).replace(/^\n/, '');
  writeFileSync(path, before + after);
  return 'removed';
}

const HOOK_COMMANDS = { UserPromptSubmit: 'codechart hook prompt', Stop: 'codechart hook stop' } as const;
const TIMEOUTS = { UserPromptSubmit: 10, Stop: 30 } as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const isCodechartHook = (h: unknown) => isObject(h) && typeof h.command === 'string' && h.command.startsWith('codechart hook ');

const runs = (command: string) => (h: unknown) => isObject(h) && h.command === command;

const hasHook = (groups: unknown[], is: (h: unknown) => boolean) => groups.some((g) => isObject(g) && Array.isArray(g.hooks) && g.hooks.some(is));

/** Drops the codechart hooks (right or wrong command) from `groups`, and any group they leave empty. */
function withoutCodechart(groups: unknown[]): { kept: unknown[]; removed: boolean } {
  let removed = false;
  const kept = groups.flatMap((g) => {
    if (!isObject(g) || !Array.isArray(g.hooks) || !g.hooks.some(isCodechartHook)) return [g];
    removed = true;
    const hooks = g.hooks.filter((h) => !isCodechartHook(h));
    return hooks.length ? [{ ...g, hooks }] : [];
  });
  return { kept, removed };
}

function readSettings(file: string): { path: string; settings: Record<string, unknown> & { hooks: Record<string, unknown> } } {
  const { path, text } = readRegular(file);
  let settings: unknown;
  try {
    settings = text === undefined || text.trim() === '' ? {} : JSON.parse(text);
  } catch {
    throw new Error(`${file}: not valid JSON; edit the hooks by hand: https://github.com/freeleex/codechart/blob/main/docs/install.md#help-agents-remember-it`);
  }
  if (!isObject(settings)) throw new Error(`${file}: not a JSON object`);
  settings.hooks ??= {};
  if (!isObject(settings.hooks)) throw new Error(`${file}: "hooks" is not an object`);
  return { path, settings: settings as Record<string, unknown> & { hooks: Record<string, unknown> } };
}

/** Adds the codechart hooks to a Claude Code settings.json, keeping everything else; a codechart hook with another command for an event is replaced. */
export function installClaudeHooks(file: string): 'added' | 'present' {
  const { path, settings } = readSettings(file);
  let added = false;
  for (const [event, command] of Object.entries(HOOK_COMMANDS) as [keyof typeof HOOK_COMMANDS, string][]) {
    const groups = (settings.hooks[event] ??= []);
    if (!Array.isArray(groups)) throw new Error(`${file}: "hooks.${event}" is not a list`);
    if (hasHook(groups, runs(command))) continue;
    settings.hooks[event] = [...withoutCodechart(groups).kept, { hooks: [{ type: 'command', command, timeout: TIMEOUTS[event] }] }];
    added = true;
  }
  if (!added) return 'present';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  return 'added';
}

/**
 * Per event (UserPromptSubmit, Stop) of a Claude Code settings.json: `ok` runs the command install writes, `wrong` has a codechart hook with another one.
 * Throws like installClaudeHooks on a file it can't read.
 */
export function claudeHookEvents(file: string): { ok: string[]; wrong: string[] } {
  const { settings } = readSettings(file);
  const state = { ok: [] as string[], wrong: [] as string[] };
  for (const [event, command] of Object.entries(HOOK_COMMANDS)) {
    const groups = settings.hooks[event];
    if (!Array.isArray(groups)) continue;
    if (hasHook(groups, runs(command))) state.ok.push(event);
    else if (hasHook(groups, isCodechartHook)) state.wrong.push(event);
  }
  return state;
}

/** Removes only the codechart hooks, then any group or event they leave empty. */
export function removeClaudeHooks(file: string): 'removed' | 'absent' {
  const { path, settings } = readSettings(file);
  let removed = false;
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) continue;
    const out = withoutCodechart(groups);
    removed ||= out.removed;
    if (out.kept.length) settings.hooks[event] = out.kept;
    else delete settings.hooks[event];
  }
  if (!removed) return 'absent';
  const { hooks, ...rest } = settings;
  writeFileSync(path, `${JSON.stringify(Object.keys(hooks).length ? settings : rest, null, 2)}\n`);
  return 'removed';
}
