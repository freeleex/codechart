import path from 'node:path';
import { Command } from 'commander';
import { findRepoRoot, loadConfig } from '../config/load.js';
import type { CommandOptions } from '../program.js';
import { type CheckResult, onlyBuiltinsToJudge, resolveRules } from '../rules/resolve.js';
import { escapeJsonControls } from '../render/strip.js';
import { releaseHint, type ReleaseHint } from './release-branch.js';
import { csv, gitFiles, selectionError, type GitSelection } from '../rules/selection.js';

type TerseResult = Partial<CheckResult> & { judgeBuiltins?: string[]; release?: ReleaseHint };

// Without exclusions remainingFiles is just the input, so it is printed only when something was excluded.
// The built-ins' when texts live in the skill, but their names stay so `{}` never reads as "nothing to draw".
function terseResult(r: CheckResult): TerseResult {
  const out: TerseResult = {};
  if (r.pathMatches.length > 0) out.pathMatches = r.pathMatches;
  if (r.excludedFiles.map.length + r.excludedFiles.flow.length > 0) {
    out.excludedFiles = r.excludedFiles;
    out.remainingFiles = r.remainingFiles;
  }
  if (r.toJudge.length > 0 && (r.unknownMatched || !onlyBuiltinsToJudge(r.toJudge))) out.toJudge = r.toJudge;
  else if (r.toJudge.length > 0 && !r.final) out.judgeBuiltins = r.toJudge.map((t) => t.rule);
  if (r.unknownMatched) out.unknownMatched = r.unknownMatched;
  if (r.final) out.final = r.final;
  return out;
}

// Pretty-printing puts every file of every match on its own line; here each entry (and each short array) takes one.
function formatResult(r: TerseResult): string {
  const one = (v: unknown) => JSON.stringify(v);
  const block = (v: unknown): string => {
    const rows = Array.isArray(v) ? (v.some((x) => typeof x === 'object' && x !== null) ? v.map(one) : undefined) : v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${one(k)}: ${one(x)}`) : undefined;
    if (!rows?.length) return one(v);
    const [open, close] = Array.isArray(v) ? ['[', ']'] : ['{', '}'];
    return `${open}\n    ${rows.join(',\n    ')}\n  ${close}`;
  };
  const rows = Object.entries(r).map(([k, v]) => `  ${one(k)}: ${block(v)}`);
  return rows.length ? `{\n${rows.join(',\n')}\n}` : '{}';
}

interface CheckFlags extends GitSelection {
  files?: string;
  matched?: string;
}

export function checkCommand(opts: CommandOptions): Command {
  const cwd = opts.cwd ?? process.cwd();
  return new Command('check')
    .description('resolve which rules apply to a set of changed files')
    .option('--files <csv>', 'comma-separated changed files')
    .option('--git', 'use staged, unstaged and untracked files from git')
    .option('--commit <sha>', 'use the files one commit changed (a merge: against its first parent)')
    .option('--since <base>', 'use the files committed since <base> (git diff <base>...HEAD); add --git for uncommitted ones too')
    .option('--head <ref>', 'with --since: compare <base>...<ref> instead of HEAD (another branch)')
    .option('--matched <csv>', 'plain-language rules that matched')
    .action((o: CheckFlags, cmd: Command) => {
      const usage = selectionError(o);
      if (usage) cmd.error(usage, { exitCode: 2 });
      try {
        const root = findRepoRoot(cwd);
        const files = o.files !== undefined ? csv(o.files).map((f) => path.resolve(cwd, f)) : gitFiles(root, o);
        const config = loadConfig({ cwd, home: opts.home, env: opts.env, warn: (l) => opts.stderr(`codechart: ${l}\n`) });
        const result = resolveRules(config, files, o.matched !== undefined ? csv(o.matched) : undefined, root ?? path.resolve(cwd));
        const hint = root ? releaseHint(config, root, o.head) : undefined;
        opts.stdout(escapeJsonControls(formatResult({ ...terseResult(result), ...(hint && { release: hint }) })) + '\n');
      } catch (e) {
        opts.stderr(`codechart: ${(e as Error).message}\n`);
        process.exitCode = 2;
      }
    });
}
