import { existsSync, lstatSync, unlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { packageFile } from '../assets.js';
import type { CommandOptions } from '../program.js';
import { readRegularFile } from '../read-regular.js';
import { installPairs, sameFile } from './copy-file.js';

// Built into dist/server.js by the legal comment in src/opencode/server.ts.
const MARK = 'codechart OpenCode plugin';

/** OpenCode auto-loads every .js file in the plugins folder of its config directory. */
export function pluginFile(home: string, env: NodeJS.ProcessEnv): string {
  const xdg = env.XDG_CONFIG_HOME;
  return join(xdg && isAbsolute(xdg) ? xdg : join(home, '.config'), 'opencode', 'plugins', 'codechart.js');
}

const pair = (file: string) => ({ source: packageFile('dist/server.js'), target: file });

function isOurs(file: string): boolean {
  try {
    return readRegularFile(file, (st) => st.isFile())?.includes(MARK) === true;
  } catch {
    return false;
  }
}

/** This version's copy, an older one of ours, someone else's file of that name, or none. */
export function pluginState(file: string): 'current' | 'outdated' | 'foreign' | 'missing' {
  if (lstatSync(file, { throwIfNoEntry: false }) === undefined) return 'missing';
  if (sameFile(pair(file))) return 'current';
  return isOurs(file) ? 'outdated' : 'foreign';
}

/** Copies the built plugin; an older copy of ours is replaced, a foreign file needs `force`. */
export const installPlugin = (file: string, force: boolean, opts: CommandOptions): boolean =>
  installPairs([pair(file)], file, 'OpenCode plugin', () => isOurs(file), force, opts);

/** Deletes our copy only. */
export function removePlugin(file: string): 'removed' | 'absent' | 'foreign' {
  const state = pluginState(file);
  if (state === 'missing') return 'absent';
  if (state === 'foreign') return 'foreign';
  if (existsSync(file)) unlinkSync(file);
  return 'removed';
}
