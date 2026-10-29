import { Command, CommanderError } from 'commander';
import { checkCommand } from './commands/check.js';
import { configCommand } from './commands/config.js';
import { initCommand } from './commands/init.js';
import { installSkillCommand } from './commands/install-skill.js';
import { renderCommand } from './commands/render.js';
import { schemaCommand } from './commands/schema.js';
import { sanitizeText } from './render/strip.js';

export interface ProgramOptions {
  cwd?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  isTTY?: boolean;
  stdin?: () => Promise<string>;
  choose?: (title: string, items: { label: string; hint: string }[]) => Promise<number[] | undefined>;
  now?: () => Date;
  open?: (path: string) => string | void;
}

export type CommandOptions = Required<Pick<ProgramOptions, 'stdout' | 'stderr'>> & ProgramOptions;

export function buildProgram(opts: ProgramOptions = {}): Command {
  const stdout = opts.stdout ?? ((s: string) => process.stdout.write(s));
  const rawStderr = opts.stderr ?? ((s: string) => process.stderr.write(s));
  const stderr = (s: string) => rawStderr(sanitizeText(s));
  const program = new Command().name('codechart').version('0.1.1');
  const cmdOpts = { ...opts, stdout, stderr };
  program.addCommand(checkCommand(cmdOpts));
  program.addCommand(renderCommand(cmdOpts));
  program.addCommand(schemaCommand(cmdOpts));
  program.addCommand(configCommand(cmdOpts));
  program.addCommand(initCommand(cmdOpts));
  program.addCommand(installSkillCommand(cmdOpts));
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
