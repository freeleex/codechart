import { homedir } from 'node:os';
import { Command } from 'commander';
import type { CommandOptions } from '../program.js';
import { type Item, runChecks, type Section } from './doctor-checks.js';
import { explainLast } from './doctor-last.js';

const MARK = { ok: '✓', warn: '⚠', bad: '✗' } as const;

const TEST_PROMPT = 'Add a constant to one file, use it in two other files, then summarize what changed.';

function show(sections: Section[], opts: CommandOptions): void {
  for (const { title, items } of sections) {
    opts.stdout(`${title}\n`);
    for (const i of items) opts.stdout(`  ${MARK[i.level]} ${i.text}${i.fix ? `: run ${i.fix}` : ''}\n`);
  }
  opts.stdout(`\nTo test, paste into your agent:\n  ${TEST_PROMPT}\nA codechart map should follow the reply.\n`);
}

const items = (sections: Section[]): Item[] => sections.flatMap((s) => s.items);
const bad = (sections: Section[]): Item[] => items(sections).filter((i) => i.level === 'bad' && !i.same);

/** Fixes the ✗ items it can, without --force: a skill folder that is not codechart's stays as it is. Opt-in ⚠ items are only named. */
async function fix(sections: Section[], opts: CommandOptions): Promise<void> {
  const ordered = [...sections.filter((s) => s.first), ...sections.filter((s) => !s.first)];
  for (const item of bad(ordered)) {
    if (!item.run) continue;
    try {
      await item.run();
    } catch (e) {
      opts.stderr(`codechart: ${item.text}: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
  for (const item of items(sections)) if (item.level === 'warn' && item.fix) opts.stdout(`not added (opt-in): ${item.fix}\n`);
}

export function doctorCommand(opts: CommandOptions): Command {
  return new Command('doctor')
    .description('check that agents can find codechart (skill, reminder, hook, CLI); --fix repairs, --last explains the last turn')
    .option('--fix', 'repair what is missing or outdated (never overwrites a skill folder that is not codechart)')
    .option('--last', "explain why the last turn in this repo did or didn't get a diagram (Claude Code)")
    .action(async (o: { fix?: boolean; last?: boolean }) => {
      const home = opts.home ?? homedir();
      if (o.last) {
        if (!explainLast(opts.cwd ?? process.cwd(), home, opts)) process.exitCode = 1;
        return;
      }
      if (o.fix) await fix(runChecks(home, opts), opts);
      const sections = runChecks(home, opts);
      show(sections, opts);
      if (bad(sections).length) process.exitCode = 1;
    });
}
