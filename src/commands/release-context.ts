import { Command } from 'commander';
import { findRepoRoot } from '../config/load.js';
import { changeTitle, fetchPr, originRemote, prNumber, runTool, type PrInfo } from '../pr/merged.js';
import type { CommandOptions } from '../program.js';
import { escapeJsonControls, sanitizeText } from '../render/strip.js';
import { gitCommitFiles, gitFileAt, gitFirstParentLog, gitLatestTag, resolveCommit } from '../rules/git-files.js';

const MAX_FILES = 40;
const MAX_PRS = 50;

interface Change {
  sha: string;
  title: string;
  date: string;
  pr?: number;
  files: string[];
  moreFiles?: number;
  prTitle?: string;
  description?: string;
  map?: unknown;
}

function repoVersion(root: string, sha: string): string | undefined {
  try {
    const text = gitFileAt(root, sha, 'package.json', 1024 * 1024);
    const v = typeof text === 'string' ? (JSON.parse(text) as { version?: unknown }).version : undefined;
    return typeof v === 'string' ? sanitizeText(v) : undefined;
  } catch {
    return undefined;
  }
}

/** PR text by number, or why it was not read. */
function readPrs(opts: CommandOptions, root: string, numbers: number[]): { prs: Map<number, PrInfo>; notes: string[] } {
  const prs = new Map<number, PrInfo>();
  if (!numbers.length) return { prs, notes: [] };
  const remote = originRemote(root);
  if (!remote) return { prs, notes: ['PR descriptions were not read: origin is not a GitHub or GitLab remote.'] };
  const tool = opts.tool ?? runTool;
  const notes: string[] = [];
  const wanted = numbers.slice(-MAX_PRS);
  if (wanted.length < numbers.length) notes.push(`Only the newest ${MAX_PRS} of ${numbers.length} PRs had their descriptions read.`);
  const skipped: number[] = [];
  let firstWhy = '';
  for (const n of wanted) {
    try {
      prs.set(n, fetchPr(tool, remote, n));
    } catch (e) {
      const why = sanitizeText((e instanceof Error ? e.message : String(e)).split('\n')[0] ?? '').replace(/\.$/, '');
      if (/ is not installed\b/.test(why)) return { prs: new Map(), notes: [`PR descriptions were not read: ${why}.`] };
      skipped.push(n);
      firstWhy ||= why;
    }
  }
  if (skipped.length) notes.push(`PR descriptions were not read for ${skipped.map((n) => `#${n}`).join(', ')}: ${firstWhy}.`);
  return { prs, notes };
}

function releaseContext(o: { since?: string; head?: string }, opts: CommandOptions, root: string): unknown {
  const headSha = resolveCommit(root, '--head', o.head ?? 'HEAD');
  // From the parent, so a release commit that is already tagged maps against the release before it.
  const since = o.since ?? gitLatestTag(root, `${headSha}^`, 'v*');
  const sinceSha = since === undefined ? undefined : resolveCommit(root, '--since', since);
  const log = gitFirstParentLog(root, sinceSha, headSha);
  const numbers = log.flatMap((e) => prNumber(e) ?? []);
  const { prs, notes } = readPrs(opts, root, numbers);
  if (since === undefined) notes.unshift('First release: no v* tag before HEAD, so this lists every commit from the start.');
  const changes = log.map((e): Change => {
    const files = gitCommitFiles(root, e.sha);
    const n = prNumber(e);
    const info = n === undefined ? undefined : prs.get(n);
    const title = sanitizeText(changeTitle(e));
    return {
      sha: e.short,
      title,
      date: e.date,
      ...(n === undefined ? {} : { pr: n }),
      files: files.slice(0, MAX_FILES).map(sanitizeText),
      ...(files.length > MAX_FILES ? { moreFiles: files.length - MAX_FILES } : {}),
      ...(info && info.title !== title ? { prTitle: info.title } : {}),
      ...(info?.description ? { description: info.description } : {}),
      ...(info?.map === undefined ? {} : { map: info.map }),
    };
  });
  const version = repoVersion(root, headSha);
  return { ...(since === undefined ? {} : { since: sanitizeText(since), sinceSha }), head: headSha, ...(version ? { version } : {}), changes, ...(notes.length ? { notes } : {}) };
}

export function releaseContextCommand(opts: CommandOptions): Command {
  const cwd = opts.cwd ?? process.cwd();
  return new Command('release-context')
    .description('list what was merged since the last release (JSON for an agent writing a release map)')
    .option('--since <ref>', 'the previous release: a tag or commit (default: the newest v* tag before HEAD; without one, every commit)')
    .option('--head <ref>', 'the release commit (default HEAD)')
    .action((o: { since?: string; head?: string }) => {
      try {
        const root = findRepoRoot(cwd);
        if (!root) throw new Error('not a git repository');
        opts.stdout(escapeJsonControls(JSON.stringify(releaseContext(o, opts, root))) + '\n');
      } catch (e) {
        opts.stderr(`codechart: ${(e as Error).message}\n`);
        process.exitCode = 2;
      }
    });
}
