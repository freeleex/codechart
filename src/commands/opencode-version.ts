import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { CommandOptions } from '../program.js';

const run = (opts: CommandOptions, command: string): string =>
  opts.tool ? opts.tool(command, ['--version']) : execFileSync(command, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });

/** The installed OpenCode's version, from PATH or ~/.opencode/bin; undefined when it can't be run or read. */
function opencodeVersion(opts: CommandOptions, home: string): string | undefined {
  for (const command of ['opencode', join(home, '.opencode', 'bin', 'opencode')]) {
    try {
      const v = /(\d+\.\d+(?:\.\d+)?)/.exec(run(opts, command))?.[1];
      if (v) return v;
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Why the plugin can't be added: OpenCode 1 has no `plugins` list of this kind, and an OpenCode we can't see could be either. */
export function pluginBlocker(opts: CommandOptions, home: string): string | undefined {
  const v = opencodeVersion(opts, home);
  if (v === undefined) return 'needs OpenCode 2 (not found)';
  return Number(v.split('.')[0]) >= 2 ? undefined : `needs OpenCode 2 (found ${v.split('.')[0]}.x)`;
}
