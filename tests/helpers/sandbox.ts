import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProgram, runProgram, type ProgramOptions } from '../../src/program.js';

export interface Sandbox {
  tmp: string;
  home: string;
  repo: string;
  /** Where HTML goes when `htmlOut` is set. */
  out: string;
}

interface SandboxOptions {
  /** The repo folder's name under tmp; false for no repo at all. */
  repo?: string | false;
  /** `dir`: an empty `.git` folder, enough for findRepoRoot; `init`: a real repo (see gitInit). */
  git?: 'dir' | 'init';
  /** Write the global config that sends HTML to `out`. */
  htmlOut?: boolean;
  /** Create `~/.config/codechart` without writing the config. */
  configDir?: boolean;
}

/** A fresh tmp dir with `home/`, and a `repo/` unless turned off. Pair with `removeSandbox` in afterEach. */
export function makeSandbox(prefix: string, o: SandboxOptions = {}): Sandbox {
  const tmp = mkdtempSync(join(tmpdir(), `codechart-${prefix}-`));
  const sb = { tmp, home: join(tmp, 'home'), repo: join(tmp, o.repo || 'repo'), out: join(tmp, 'out') };
  mkdirSync(o.htmlOut || o.configDir ? join(sb.home, '.config', 'codechart') : sb.home, { recursive: true });
  if (o.htmlOut) writeFileSync(join(sb.home, '.config', 'codechart', 'config.yaml'), `web:\n  outDir: ${sb.out}\n`);
  if (o.repo !== false) mkdirSync(o.git === 'dir' ? join(sb.repo, '.git') : sb.repo, { recursive: true });
  if (o.git === 'init') gitInit(sb.repo);
  process.exitCode = undefined;
  return sb;
}

export function removeSandbox(tmp: string): void {
  rmSync(tmp, { recursive: true, force: true });
  process.exitCode = undefined;
}

export const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

/** `git init` with an identity and no signing, so commits work on any machine. */
export function gitInit(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'config', 'commit.gpgsign', 'false');
}

/** Runs the CLI in-process with the given options and returns what it printed. */
export async function runCli(opts: ProgramOptions, args: string[]): Promise<{ out: string; err: string; code: typeof process.exitCode }> {
  let out = '';
  let err = '';
  const program = buildProgram({ env: {}, ...opts, stdout: (s) => (out += s), stderr: (s) => (err += s) });
  await runProgram(program, args, 'user');
  return { out, err, code: process.exitCode };
}

export const makeTempDir = (prefix: string): string => mkdtempSync(join(tmpdir(), `codechart-${prefix}-`));

export const removeTempDir = (dir: string): void => rmSync(dir, { recursive: true, force: true });
