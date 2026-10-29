import path from 'node:path';
import { Command } from 'commander';
import { findRepoRoot, loadConfig } from '../config/load.js';
import { gitChangedFiles, gitCommitFiles, gitSinceFiles } from '../rules/git-files.js';
import type { CommandOptions } from '../program.js';
import { type CheckResult, onlyBuiltinsToJudge, resolveRules } from '../rules/resolve.js';
import { escapeJsonControls } from '../render/strip.js';

const csv = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

type TerseResult = Partial<CheckResult> & { judgeBuiltins?: string[] };

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

interface CheckFlags {
  files?: string;
  git?: boolean;
  commit?: string;
  since?: string;
  head?: string;
  matched?: string;
}

function selectionError(o: CheckFlags): string | undefined {
  if (o.files !== undefined && csv(o.files).length === 0) return '--files is empty';
  const sources = [o.files !== undefined, o.git, o.commit !== undefined, o.since !== undefined].filter(Boolean).length;
  const gitPlusSince = sources === 2 && o.git && o.since !== undefined;
  if (sources === 0 || (sources > 1 && !gitPlusSince)) {
    return 'specify one of --files, --git, --commit or --since (only --git and --since combine)';
  }
  if (o.head !== undefined && o.since === undefined) return '--head needs --since';
  if (o.head !== undefined && o.git) return '--head compares another branch, so it does not combine with --git';
  return undefined;
}

function gitFiles(root: string | undefined, o: CheckFlags): string[] {
  if (!root) throw new Error('not a git repository (use --files)');
  const files: string[] = [];
  if (o.since !== undefined) files.push(...gitSinceFiles(root, o.since, o.head));
  if (o.commit !== undefined) files.push(...gitCommitFiles(root, o.commit));
  if (o.git) files.push(...gitChangedFiles(root));
  return files;
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
        opts.stdout(escapeJsonControls(JSON.stringify(terseResult(result), null, 2)) + '\n');
      } catch (e) {
        opts.stderr(`codechart: ${(e as Error).message}\n`);
        process.exitCode = 2;
      }
    });
}
