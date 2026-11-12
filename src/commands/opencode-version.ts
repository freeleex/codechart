import { execFileSync } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import type { CommandOptions } from '../program.js';
import { trustedBinary } from '../rules/git-files.js';

interface VersionDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (p: string) => boolean;
  exec?: (file: string, args: string[]) => string;
}

// The fallback under home is an absolute path, not a bare name, so it is not looked up on PATH.
const run = (opts: CommandOptions, command: string, deps: VersionDeps): string => {
  if (opts.tool) return opts.tool(command, ['--version']);
  const file = isAbsolute(command) ? command : trustedBinary(command, deps.platform, deps.env, deps.exists);
  const exec = deps.exec ?? ((f: string, a: string[]) => execFileSync(f, a, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }));
  return exec(file, ['--version']);
};

/** The installed OpenCode's version, from PATH or ~/.opencode/bin; undefined when it can't be run or read. */
function opencodeVersion(opts: CommandOptions, home: string, deps: VersionDeps): string | undefined {
  for (const command of ['opencode', join(home, '.opencode', 'bin', 'opencode')]) {
    try {
      const v = /(\d+\.\d+(?:\.\d+)?)/.exec(run(opts, command, deps))?.[1];
      if (v) return v;
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Why the plugin can't be added: OpenCode 1 has no `plugins` list of this kind, and an OpenCode we can't see could be either. */
export function pluginBlocker(opts: CommandOptions, home: string, deps: VersionDeps = {}): string | undefined {
  const v = opencodeVersion(opts, home, deps);
  if (v === undefined) return 'needs OpenCode 2 (not found)';
  return Number(v.split('.')[0]) >= 2 ? undefined : `needs OpenCode 2 (found ${v.split('.')[0]}.x)`;
}
