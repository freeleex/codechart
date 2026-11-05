import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { Command } from 'commander';
import { packageFile } from '../assets.js';
import { loadConfig } from '../config/load.js';
import type { CommandOptions } from '../program.js';
import { currentVersion, fetchLatest, isNewer, readState, skillDirs, writeState } from '../update/check.js';
import { AGENTS, isCodechartSkill } from './agents.js';
import { installCopy, skillFiles } from './install-skill.js';
import { refreshReminder } from './nudges.js';

const RELEASES = 'https://github.com/freeleex/codechart/releases';

interface Runner {
  /** Runs and returns stdout. */
  capture: (command: string, args: string[]) => string;
  /** Runs with its output shown; throws on failure. */
  show: (command: string, args: string[]) => void;
}

// npm is npm.cmd on Windows, which Node only starts through a shell; cmd.exe looks in the working folder first,
// so a repo's own npm.cmd would win: run it from node's folder, where npm.cmd lives. The arguments are fixed.
export const spawnOptions = (command: string, platform = process.platform): { shell: boolean; cwd?: string } =>
  platform === 'win32' && command === 'npm' ? { shell: true, cwd: dirname(process.execPath) } : { shell: false };
const binary = (command: string): [string, string[]] => (command === 'codechart' ? [process.execPath, [process.argv[1]!]] : [command, []]);

const defaultRunner: Runner = {
  capture: (command, args) => execFileSync(command, args, { encoding: 'utf8', ...spawnOptions(command), stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 }),
  show: (command, args) => {
    const [bin, pre] = binary(command);
    const r = spawnSync(bin, [...pre, ...args], { stdio: 'inherit', ...spawnOptions(command) });
    if (r.status !== 0) throw new Error(`${command} ${args.join(' ')} failed${r.error ? `: ${r.error.message}` : ''}`);
  },
};

/** How this copy of codechart was installed: npm global, or a hint for anything else. */
export function installedBy(installDir: string, npmRoot: string | undefined): { npm: true } | { npm: false; hint: string } {
  const real = (p: string) => (existsSync(p) ? realpathSync(p) : resolve(p));
  if (npmRoot && real(installDir) === real(join(npmRoot, 'codechart'))) return { npm: true };
  if (/[\\/]_npx[\\/]/.test(installDir)) return { npm: false, hint: 'npx runs the newest codechart already; nothing to update' };
  if (installDir.includes(`${sep}pnpm${sep}`) || installDir.includes('/pnpm/')) return { npm: false, hint: 'update it with: pnpm add -g codechart@latest' };
  if (installDir.includes('.bun')) return { npm: false, hint: 'update it with: bun add -g codechart@latest' };
  if (installDir.includes('yarn')) return { npm: false, hint: 'update it with: yarn global add codechart@latest' };
  return { npm: false, hint: `it isn't npm's global copy (${installDir}); update it the way you installed it` };
}

export const cacheDirOf = (opts: CommandOptions) => loadConfig({ cwd: opts.cwd ?? process.cwd(), home: opts.home, env: opts.env }).web.outDir;

/** Brings every codechart skill copy already installed, and reminder lines already added, up to this version. */
function refreshInstalls(home: string, opts: CommandOptions): void {
  const files = skillFiles();
  const folders = [...new Set(AGENTS.flatMap((a) => [a.skills, ...a.reads]))];
  const dirs = [
    ...folders.map((folder) => ({ dir: join(home, folder, 'codechart'), who: AGENTS.filter((a) => [a.skills, ...a.reads].includes(folder)).map((a) => a.label).join(', ') })),
    ...skillDirs(readState(cacheDirOf(opts))).map((dir) => ({ dir, who: 'your folder' })),
  ];
  for (const { dir, who } of dirs) {
    let ours = false;
    try {
      ours = existsSync(dir) && isCodechartSkill(dir);
    } catch {
      ours = false;
    }
    if (!ours) continue;
    installCopy(dir, who, files, false, opts);
  }
  for (const a of AGENTS) {
    if (!a.instructions) continue;
    if (refreshReminder(join(home, a.instructions)) === 'updated') opts.stdout(`reminder updated: ${join(home, a.instructions)}\n`);
  }
}

async function update(o: { check?: boolean }, opts: CommandOptions, runner: Runner): Promise<void> {
  const home = opts.home ?? homedir();
  const current = currentVersion();
  const latest = await fetchLatest(opts.fetch ?? fetch, 10_000);
  if (!latest) throw new Error("couldn't reach the npm registry to look up the newest version");
  const cacheDir = cacheDirOf(opts);
  writeState(cacheDir, { ...readState(cacheDir), checkedAt: opts.now?.().getTime() ?? Date.now(), latest });
  if (!isNewer(latest, current)) {
    opts.stdout(`codechart ${current} is the newest version.\n`);
    if (!o.check) refreshInstalls(home, opts);
    return;
  }
  if (o.check) {
    opts.stdout(`codechart ${latest} is available (you have ${current}): run codechart update\n`);
    return;
  }
  let npmRoot: string | undefined;
  try {
    npmRoot = runner.capture('npm', ['root', '-g']).trim();
  } catch {
    npmRoot = undefined;
  }
  const how = installedBy(packageFile(''), npmRoot);
  if (!how.npm) {
    opts.stdout(`codechart ${latest} is available (you have ${current}), but ${how.hint}.\n`);
    return;
  }
  opts.stdout(`Updating codechart ${current} → ${latest}: npm install -g codechart@${latest}\n`);
  runner.show('npm', ['install', '-g', `codechart@${latest}`]);
  // The new version's own files and code refresh the skill copies.
  runner.show('codechart', ['update', '--skills-only']);
  opts.stdout(`codechart ${latest} installed. What changed: ${RELEASES}\n`);
}

/** The update command's work, for callers that handle its errors themselves. */
export async function runUpdate(o: { check?: boolean }, opts: CommandOptions): Promise<void> {
  const tool = opts.tool;
  await update(o, opts, tool ? { capture: tool, show: (c, a) => void tool(c, a) } : defaultRunner);
}

export function updateCommand(opts: CommandOptions): Command {
  return new Command('update')
    .description('install the newest codechart with npm and refresh the skill copies and reminder lines you have')
    .option('--check', 'only say whether a newer version exists')
    .option('--skills-only', 'refresh installed skill copies and reminder lines to this version (run by update)')
    .action(async (o: { check?: boolean; skillsOnly?: boolean }) => {
      try {
        if (o.skillsOnly) return refreshInstalls(opts.home ?? homedir(), opts);
        await runUpdate(o, opts);
      } catch (e) {
        opts.stderr(`codechart: ${e instanceof Error ? e.message : String(e)}\n`);
        process.exitCode = 1;
      }
    });
}
