import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const REMINDER =
  'Before summarizing or planning a change that touches 3+ files or adds behaviour with branches, use the codechart skill (skip it for small edits: typos, formatting, one-line fixes).';
const START = '<!-- codechart -->';
const END = '<!-- /codechart -->';
const BLOCK = `${START}\n${REMINDER}\n${END}`;

// Instruction and settings files are often symlinks into a dotfiles repo, so writes follow them.
function readRegular(file: string): string | undefined {
  const st = statSync(file, { throwIfNoEntry: false });
  if (st && !st.isFile()) throw new Error(`${file}: not a regular file`);
  return st ? readFileSync(file, 'utf8') : undefined;
}

/** Adds the reminder between codechart markers once; `force` replaces a different one. */
export function addReminder(file: string, force: boolean): 'added' | 'updated' | 'present' | 'outdated' {
  const text = readRegular(file) ?? '';
  const at = text.indexOf(START);
  const end = at < 0 ? -1 : text.indexOf(END, at);
  if (end > at) {
    if (text.slice(at, end + END.length) === BLOCK) return 'present';
    if (!force) return 'outdated';
    writeFileSync(file, text.slice(0, at) + BLOCK + text.slice(end + END.length));
    return 'updated';
  }
  mkdirSync(dirname(file), { recursive: true });
  const gap = text === '' || text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(file, `${text}${gap}${BLOCK}\n`);
  return 'added';
}

export const HOOK_COMMANDS = { UserPromptSubmit: 'codechart hook prompt', Stop: 'codechart hook stop' } as const;
const TIMEOUTS = { UserPromptSubmit: 10, Stop: 30 } as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const hasCodechartHook = (groups: unknown[]) =>
  groups.some((g) => isObject(g) && Array.isArray(g.hooks) && g.hooks.some((h) => isObject(h) && typeof h.command === 'string' && h.command.startsWith('codechart hook ')));

/** Adds the codechart hooks to a Claude Code settings.json, keeping everything else. */
export function installClaudeHooks(file: string): 'added' | 'present' {
  const raw = readRegular(file);
  let settings: unknown;
  try {
    settings = raw === undefined || raw.trim() === '' ? {} : JSON.parse(raw);
  } catch {
    throw new Error(`${file}: not valid JSON; add the hooks by hand (see the README)`);
  }
  if (!isObject(settings)) throw new Error(`${file}: not a JSON object`);
  settings.hooks ??= {};
  if (!isObject(settings.hooks)) throw new Error(`${file}: "hooks" is not an object`);
  let added = false;
  for (const [event, command] of Object.entries(HOOK_COMMANDS) as [keyof typeof HOOK_COMMANDS, string][]) {
    const groups = (settings.hooks[event] ??= []);
    if (!Array.isArray(groups)) throw new Error(`${file}: "hooks.${event}" is not a list`);
    if (hasCodechartHook(groups)) continue;
    groups.push({ hooks: [{ type: 'command', command, timeout: TIMEOUTS[event] }] });
    added = true;
  }
  if (!added) return 'present';
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return 'added';
}
