import { execFileSync } from 'node:child_process';
import { closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Command, Option } from 'commander';
import { findRepoRoot } from '../config/load.js';
import type { CommandOptions } from '../program.js';
import { readRegularFile } from '../read-regular.js';
import { gitRun } from '../pr/git.js';
import { currentVersion } from '../update/check.js';
import { buildPlan, openSetupReview, parseRemote, prepareSetupReview, type Host, type Plan, type Remote, type Tool } from '../pr/setup.js';

interface Flags {
  yes?: boolean;
  pr?: boolean;
  host?: Host;
}

function remoteOf(root: string, host: Host | undefined): Remote {
  let url: string;
  try {
    url = gitRun(root, ['config', '--get', 'remote.origin.url']);
  } catch {
    throw new Error('no origin remote: PR maps need the repo on GitHub or GitLab');
  }
  const remote = parseRemote(url, host);
  if (!remote) throw new Error(`can't tell whether ${url} is GitHub or GitLab; add --host github or --host gitlab`);
  return remote;
}

function readWorkTree(root: string): (file: string) => string | undefined {
  return (file) => {
    const path = join(root, file);
    let text: string | undefined;
    try {
      // lstat after open catches symlinks where O_NOFOLLOW doesn't exist (Windows)
      text = readRegularFile(path, (st) => st.isFile() && lstatSync(path).isFile());
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return undefined;
      if (code !== 'ELOOP') throw e;
    }
    if (text === undefined) throw new Error(`${file}: not a regular file; refusing to write it`);
    return text;
  };
}

// New file: O_EXCL, so nothing created meanwhile gets overwritten; existing one: never through a swapped-in symlink.
function writeWorkTree(root: string, plan: Plan): void {
  const path = join(root, plan.file);
  mkdirSync(dirname(path), { recursive: true });
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0) | (plan.appended ? 0 : constants.O_EXCL);
  let fd: number;
  try {
    fd = openSync(path, flags, 0o644);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'ELOOP') throw new Error(`${plan.file}: changed while codechart was running; run it again`);
    throw e;
  }
  try {
    writeFileSync(fd, plan.content);
  } finally {
    closeSync(fd);
  }
}

function describe(plan: Plan, pr: boolean): string {
  const what = plan.appended ? `append this job to ${plan.file}` : `add ${plan.file}`;
  const where = pr ? `open a ${plan.remote.host === 'github' ? 'pull' : 'merge'} request on ${plan.remote.path} that would ${what}` : `${what} in your work tree (not committed)`;
  const body = plan.added.trimEnd().split('\n').map((l) => `    ${l}`);
  return [`codechart setup-pr-maps would ${where}:`, '', ...body, '', ...plan.notes, ''].join('\n') + '\n';
}

async function terminalConfirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

const defaultTool: Tool = (command, args) => {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`${command} is not installed; install it or run without --pr`);
    throw new Error(`${command} failed: ${String((e as { stderr?: unknown }).stderr ?? (e as Error).message).trim()}`);
  }
};

async function agreed(o: Flags, opts: CommandOptions): Promise<boolean> {
  if (o.yes) return true;
  const confirm = opts.confirm ?? (process.stdin.isTTY && process.stdout.isTTY ? terminalConfirm : undefined);
  if (confirm) return confirm(o.pr ? 'Open it? [y/N] ' : 'Write it? [y/N] ');
  opts.stdout(`Nothing changed. To go ahead, run again with --yes${o.pr ? ' --pr' : ' (or --yes --pr to open a pull request instead)'}.\n`);
  return false;
}

async function setup(o: Flags, opts: CommandOptions, root: string): Promise<void> {
  const remote = remoteOf(root, o.host);
  const v = currentVersion();
  const done = () => opts.stdout(`codechart: PR maps are already set up in ${remote.path}.\n`);
  if (o.pr) {
    const prepared = prepareSetupReview(root, v, remote);
    if (!prepared.plan) return done();
    opts.stdout(describe(prepared.plan, true));
    if (!(await agreed(o, opts))) return;
    const url = openSetupReview(root, { ...prepared, plan: prepared.plan }, opts.tool ?? defaultTool);
    opts.stdout(`codechart: opened ${url}\nMerge it to turn PR maps on; close it to say no.\n`);
    return;
  }
  const plan = buildPlan(remote, v, readWorkTree(root));
  if (!plan) return done();
  opts.stdout(describe(plan, false));
  if (!(await agreed(o, opts))) return;
  writeWorkTree(root, plan);
  const next = remote.host === 'gitlab' ? ', then add the CODECHART_GITLAB_TOKEN variable as above' : '';
  opts.stdout(`codechart: wrote ${plan.file}. Review it, commit and push it${next}.\n`);
}

export function setupPrMapsCommand(opts: CommandOptions): Command {
  const cwd = opts.cwd ?? process.cwd();
  return new Command('setup-pr-maps')
    .description('add the CI job that keeps codechart maps in PR/MR descriptions current; shows the change and asks first')
    .option('--yes', "don't ask: needed when not run from a terminal")
    .option('--pr', 'open a pull or merge request with the change (needs gh or glab) instead of writing it to the work tree')
    .addOption(new Option('--host <host>', 'when the origin URL names neither').choices(['github', 'gitlab']))
    .action(async (o: Flags) => {
      try {
        const root = findRepoRoot(cwd);
        if (!root) throw new Error('not a git repository');
        await setup(o, opts, root);
      } catch (e) {
        opts.stderr(`codechart: ${e instanceof Error ? e.message : String(e)}\n`);
        process.exitCode = 1;
      }
    });
}
