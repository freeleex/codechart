import { Command, CommanderError } from 'commander';
import { checkCommand } from './commands/check.js';
import { commentCommand } from './commands/comment.js';
import { configCommand } from './commands/config.js';
import { doctorCommand } from './commands/doctor.js';
import { feedbackCommand } from './commands/feedback.js';
import { hookCommand } from './commands/hook.js';
import { initCommand } from './commands/init.js';
import { prSyncCommand } from './commands/pr-sync.js';
import { setupPrMapsCommand } from './commands/setup-pr-maps.js';
import { updateCommand } from './commands/update.js';
import { installSkillCommand } from './commands/install-skill.js';
import { renderCommand } from './commands/render.js';
import { releaseContextCommand } from './commands/release-context.js';
import type { RunBrowser } from './commands/release-pdf.js';
import { reviewCommand } from './commands/review.js';
import { schemaCommand } from './commands/schema.js';
import { uninstallCommand } from './commands/uninstall.js';
import { loadConfig } from './config/load.js';
import { sanitizeText } from './render/strip.js';
import { currentVersion, updateNotice } from './update/check.js';

export interface ProgramOptions {
  cwd?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  isTTY?: boolean;
  stdin?: () => Promise<string>;
  /** Whether stdin carries data (a pipe or a non-empty file) rather than a terminal or nothing; `feedback --import` reads the clipboard otherwise. */
  stdinPiped?: () => boolean;
  /** The system clipboard's text, for `feedback --import` off a pipe. */
  readClipboard?: () => string;
  /** `checked`: whether items start selected (default true). */
  choose?: (title: string, items: { label: string; hint: string }[], checked?: boolean) => Promise<number[] | undefined>;
  now?: () => Date;
  open?: (path: string) => string | void;
  /** Yes/no question; without it, commands that ask need --yes off a terminal. */
  confirm?: (question: string) => Promise<boolean>;
  /** Runs gh, glab or npm. */
  tool?: (command: string, args: string[]) => string;
  fetch?: typeof fetch;
  /** Runs the editor `review` opens on a file with `$VISUAL`/`$EDITOR`/`vi`; returns its exit status. */
  editor?: (command: string, file: string) => number;
  /** Unsanitized stderr, for terminal escape codes (`feedback --copy`). */
  rawStderr?: (s: string) => void;
  /** Finds and runs the browser that prints a release map to PDF (tests inject fakes). */
  pdf?: { find?: (configured?: string) => string | undefined; run?: RunBrowser };
  /** False turns off the daily new-version check (tests). */
  updateCheck?: boolean;
}

// Run by hooks and CI, or checking on their own.
const NO_NOTICE = new Set(['hook', 'pr-sync', 'update', 'uninstall', 'doctor', 'comment', 'feedback']);

async function noticeAfter(name: string, opts: ProgramOptions, stderr: (s: string) => void): Promise<void> {
  if (opts.updateCheck === false || NO_NOTICE.has(name)) return;
  try {
    const env = opts.env ?? process.env;
    const config = loadConfig({ cwd: opts.cwd ?? process.cwd(), home: opts.home, env });
    const line = await updateNotice({
      cacheDir: config.web.outDir,
      enabled: config.updateCheck,
      // An opt-out in the real environment counts even when a caller passes its own env.
      env: { ...process.env, ...env },
      terminal: opts.isTTY ?? (process.stdout.isTTY === true && process.stderr.isTTY === true),
      now: opts.now?.().getTime() ?? Date.now(),
      fetch: opts.fetch ?? fetch,
    });
    if (line) stderr(`${line}\n`);
  } catch {
    // A broken config is the command's to report, not the notice's.
  }
}

export type CommandOptions = Required<Pick<ProgramOptions, 'stdout' | 'stderr'>> & ProgramOptions;

export function buildProgram(opts: ProgramOptions = {}): Command {
  const stdout = opts.stdout ?? ((s: string) => process.stdout.write(s));
  const rawStderr = opts.stderr ?? ((s: string) => process.stderr.write(s));
  const stderr = (s: string) => rawStderr(sanitizeText(s));
  const program = new Command().name('codechart').version(currentVersion());
  const cmdOpts = { ...opts, stdout, stderr, rawStderr: opts.rawStderr ?? rawStderr };
  program.addCommand(checkCommand(cmdOpts));
  program.addCommand(renderCommand(cmdOpts));
  program.addCommand(schemaCommand(cmdOpts));
  program.addCommand(configCommand(cmdOpts));
  program.addCommand(initCommand(cmdOpts));
  program.addCommand(installSkillCommand(cmdOpts));
  program.addCommand(uninstallCommand(cmdOpts));
  program.addCommand(hookCommand(cmdOpts));
  program.addCommand(prSyncCommand(cmdOpts));
  program.addCommand(setupPrMapsCommand(cmdOpts));
  program.addCommand(updateCommand(cmdOpts));
  program.addCommand(doctorCommand(cmdOpts));
  program.addCommand(releaseContextCommand(cmdOpts));
  program.addCommand(reviewCommand(cmdOpts));
  program.addCommand(commentCommand(cmdOpts));
  program.addCommand(feedbackCommand(cmdOpts));
  program.hook('postAction', (_program, action) => noticeAfter(action.name(), cmdOpts, stderr));
  // addCommand does not inherit these settings
  for (const c of [program, ...program.commands]) {
    c.exitOverride().configureOutput({ writeOut: stdout, writeErr: stderr });
  }
  return program;
}

export async function runProgram(program: Command, argv: string[], from?: 'user'): Promise<void> {
  try {
    await program.parseAsync(argv, from && { from });
  } catch (e) {
    if (!(e instanceof CommanderError)) throw e;
    process.exitCode = e.exitCode === 0 ? 0 : 2;
  }
}
