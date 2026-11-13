import { basename, dirname, join, resolve } from 'node:path';
import { Command, Option } from 'commander';
import { findRepoRoot, loadConfig } from '../config/load.js';
import { THEMES, type Config, type Diagram, type Output, type Theme } from '../config/schema.js';
import type { CommandOptions } from '../program.js';
import { diffOf, type Diff } from '../render/check.js';
import type { Drift } from '../render/drift.js';
import { checkFlowAnchors, type FlowSnippets } from '../render/flow/anchors.js';
import { openBlockedNote } from '../render/markdown.js';
import { fileSlug, repoFolder } from '../render/output-path.js';
import { loadPlan, savePlan, type PlanStoreOptions, type StoredPlan } from '../render/plan-store.js';
import { flagged, type CheckSummary } from '../render/terminal/check-lines.js';
import { defaultWidth } from '../render/terminal/render.js';
import { privateDir, writeReviewOnly } from '../render/web/write.js';
import { gitHead, gitMergeBase, gitParent, resolveCommit } from '../rules/git-files.js';
import { unionOutputs, unmappedFiles } from '../rules/resolve.js';
import { gitChanges, hasGitSelection, selectionError, type GitSelection } from '../rules/selection.js';
import type { FlowSpec } from '../spec/flow.js';
import type { BusinessSpec } from '../spec/business.js';
import type { ReleaseSpec } from '../spec/release.js';
import { validateAnySpec, type Spec } from '../spec/schema.js';
import { MAX_SPEC_BYTES } from '../spec/shared.js';
import type { RenderContext } from './choose-output.js';
import { htmlWriter } from './html-writer.js';
import { renderFlow } from './render-flow.js';
import { renderMap } from './render-map.js';
import { renderBusinessSpec } from './render-business.js';
import { renderReleaseSpec } from './render-release.js';
import { InvalidSpec, readSpecJson, TOO_BIG } from './spec-input.js';
import { readStdin } from './stdin.js';

function specOutput(config: Config, ruleNames: string[], diagram: Diagram): Output {
  const outputs = ruleNames.map((name) => {
    const rule = config.rules.find((r) => r.name === name);
    if (!rule) throw new Error(`unknown rule in spec: ${name}`);
    if ((rule.diagram ?? 'map') !== diagram) throw new Error(`rule in spec is not a ${diagram} rule: ${name}`);
    return rule.output ?? config.defaults.output;
  });
  return unionOutputs(outputs);
}

async function readSpec(arg: string, cwd: string, stdin: () => Promise<string>): Promise<Spec | FlowSpec | BusinessSpec | ReleaseSpec> {
  const result = validateAnySpec(await readSpecJson(arg, cwd, stdin));
  if (!result.ok) throw new InvalidSpec(result.errors);
  return result.spec;
}

type Target = { diagram: 'flow'; spec: FlowSpec; snippets: FlowSnippets; checked: number } | { diagram: 'map'; spec: Spec };

function targetOf(spec: Spec | FlowSpec, root: string, at: string | undefined, cwd: string, o: RenderFlags): Target {
  if (o.tech !== undefined) throw new Error('--tech only applies to business maps');
  if (spec.diagram !== 'flow') return { diagram: 'map', spec };
  if (o.pr) throw new Error('--pr draws maps only');
  const anchors = checkFlowAnchors(spec, root, at, cwd);
  if (!anchors.ok) throw new InvalidSpec(anchors.errors);
  return { diagram: 'flow', spec, snippets: anchors.snippets, checked: anchors.checked };
}

interface RenderFlags extends GitSelection {
  output?: Exclude<Output, 'none'>;
  theme?: Theme;
  open?: boolean;
  md?: boolean;
  pr?: boolean;
  svg?: string;
  imageUrl?: string;
  at?: string;
  strict?: boolean;
  tech?: string;
  pdf?: string;
}

function renderSelectionError(o: RenderFlags): string | undefined {
  if (!hasGitSelection(o)) return undefined;
  if (o.head !== undefined && o.since === undefined) return '--head needs --since';
  if (o.commit !== undefined && (o.git || o.since !== undefined)) return '--commit does not combine with --git or --since';
  return selectionError(o);
}

/** A bad flag value, as opposed to a failure while drawing: exits 2. */
class UsageError extends Error {}

function revision(root: string, flag: string, ref: string): string {
  try {
    return resolveCommit(root, flag, ref);
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
}

function resolveAt(o: RenderFlags, repoRoot: string | undefined, root: string): string | undefined {
  if (o.at === undefined) return undefined;
  if (!repoRoot) throw new Error('--at needs a git repository');
  return revision(root, '--at', o.at);
}

function selectedDiff(o: RenderFlags, repoRoot: string | undefined, root: string): Diff | undefined {
  if (!hasGitSelection(o)) return undefined;
  if (!repoRoot) throw new Error('--git, --commit and --since need a git repository');
  if (o.commit !== undefined) revision(root, '--commit', o.commit);
  if (o.since !== undefined) revision(root, '--since', o.since);
  if (o.head !== undefined) revision(root, '--head', o.head);
  const changes = gitChanges(root, o, true);
  return diffOf(changes.map((c) => c.path), changes);
}

/** Without `--svg`, the image goes to the private cache folder: a fixed path in a shared temp dir could be a planted symlink. */
function prTarget(o: RenderFlags, cwd: string, cacheFile: string): RenderContext['pr'] {
  if (!o.pr) return undefined;
  if (o.svg !== undefined) return { svg: resolve(cwd, o.svg), imageUrl: o.imageUrl ?? basename(o.svg) };
  privateDir(dirname(cacheFile));
  return { svg: cacheFile, imageUrl: o.imageUrl ?? basename(cacheFile) };
}

/** Full sha of where the selected diff starts; undefined without a diff flag, null when no commit precedes it (root commit) or none is found. */
function rangeStart(o: RenderFlags, root: string): string | null | undefined {
  if (!hasGitSelection(o)) return undefined;
  try {
    if (o.commit !== undefined) return gitParent(root, resolveCommit(root, '--commit', o.commit)) ?? null;
    if (o.since !== undefined) return gitMergeBase(root, o.since);
    return gitHead(root) ?? null;
  } catch {
    return null;
  }
}

/** A plan is saved for the summary that follows it, a summary gets the saved plan: neither for `--pr`, no plan saved for an older commit, and no plan for a summary of another target (`--at`, `--head`): the branch's plan and HEAD don't apply to it. A summary with a diff flag gets it only when its range starts at the plan's commit or before. */
function planFor(spec: Spec | FlowSpec, diagram: Diagram, store: PlanStoreOptions & { inRepo: boolean }, o: RenderFlags): StoredPlan | undefined {
  if (!store.inRepo || o.pr || spec.kind === 'explain') return undefined;
  if (spec.kind === 'summary') {
    if (o.at !== undefined || o.head !== undefined) return undefined;
    const start = rangeStart(o, store.root);
    return start === null ? undefined : loadPlan(store, diagram, start);
  }
  if (o.at === undefined && o.head === undefined) savePlan(store, spec);
  return undefined;
}

const failed = (check: CheckSummary, drift: Drift<unknown> | undefined): boolean => flagged(check) || (drift?.unexplained ?? 0) > 0;
const clock = (opts: CommandOptions): Date => opts.now?.() ?? new Date();

/** Business and release maps are HTML-only pages: the output mode and the diff flags don't apply. */
const isPageSpec = (spec: Spec | FlowSpec | BusinessSpec | ReleaseSpec): spec is BusinessSpec | ReleaseSpec => spec.diagram === 'business' || spec.diagram === 'release';

const renderPageSpec = (spec: BusinessSpec | ReleaseSpec, o: RenderFlags, opts: CommandOptions, cwd: string): Promise<void> =>
  spec.diagram === 'business' ? renderBusinessSpec(spec, o, opts, cwd) : renderReleaseSpec(spec, o, opts, cwd);

/** An explain map shows the code as it is, so there is no change to check and nothing to put in a PR. */
function explainFlags(spec: Spec | FlowSpec, o: RenderFlags): void {
  if (spec.kind !== 'explain') return;
  if (hasGitSelection(o)) throw new Error('--git, --commit, --since and --head do not apply to an explain map: it shows the code as it is (--at reads another commit)');
  if (o.pr) throw new Error('explain maps are not for PR descriptions');
}

/** An explain map's files are named apart from a change map's of the same title. */
const slugKind = (spec: Spec | FlowSpec, diagram: Diagram): Diagram | 'explain' => (spec.kind === 'explain' ? 'explain' : diagram);

function pdfOnlyForRelease(spec: { diagram?: string }, o: RenderFlags): void {
  if (o.pdf !== undefined && spec.diagram !== 'release') throw new Error('--pdf only applies to release maps');
}

async function renderSpec(arg: string, o: RenderFlags, opts: CommandOptions, cwd: string): Promise<void> {
  const spec = await readSpec(arg, cwd, opts.stdin ?? (() => readStdin(MAX_SPEC_BYTES, new Error(TOO_BIG))));
  pdfOnlyForRelease(spec, o);
  if (isPageSpec(spec)) return renderPageSpec(spec, o, opts, cwd);
  explainFlags(spec, o);
  const repoRoot = findRepoRoot(cwd);
  const root = repoRoot ?? resolve(cwd);
  const at = resolveAt(o, repoRoot, root);
  const target = targetOf(spec, root, at, resolve(cwd), o);
  const diff = selectedDiff(o, repoRoot, root);
  const config = loadConfig({ cwd, home: opts.home, env: opts.env, warn: (l) => opts.stderr(`codechart: ${l}\n`) });
  const rules = spec.rules ?? [];
  const resolved = rules.length ? specOutput(config, rules, target.diagram) : config.defaults.output;
  const output = o.output ?? resolved;
  if (output === 'none') {
    const why = rules.length ? `its rules (${rules.join(', ')}) resolve to output none` : 'defaults.output is none';
    opts.stderr(`codechart: no ${target.diagram} drawn: ${why}\n`);
    return;
  }

  const env = opts.env ?? process.env;
  const now = clock(opts);
  const slug = fileSlug(spec.title, slugKind(spec, target.diagram));
  const ctx: RenderContext = {
    output,
    minNodes: config.web.minNodes,
    maxNodes: config.defaults.terminalMaxNodes,
    width: defaultWidth({ isTTY: opts.isTTY ?? process.stdout.isTTY, columns: process.stdout.columns }, env),
    color: !o.md && (opts.isTTY ?? process.stdout.isTTY === true),
    md: o.md === true,
    pr: prTarget(o, cwd, join(config.web.outDir, repoFolder(root), `${slug}.svg`)),
    root,
    cwd: resolve(cwd),
    at,
    diff,
    unmapped: unmappedFiles(config),
    diffUnchecked: spec.kind === 'summary' && !diff && repoRoot !== undefined,
    selection: o,
    now,
    plan: planFor(spec, target.diagram, { cacheDir: config.web.outDir, root, now, inRepo: repoRoot !== undefined }, o),
    saveReview: (snapshot) => writeReviewOnly(snapshot, { config, root, slug, now, stderr: opts.stderr }),
    write: htmlWriter({ config, root, slug, theme: o.theme, now, open: o.open }, opts),
  };
  const { text, check, html, drift } = target.diagram === 'flow' ? await renderFlow(target.spec, target, ctx) : await renderMap(target.spec, ctx);
  // A blank line after --md output keeps two renders in one Bash call from gluing together.
  const print = (s: string) => opts.stdout(ctx.md ? `${s}\n` : s);
  print(text);
  if (html?.openFailed) print(openBlockedNote(html.file, ctx.md));
  if (o.strict && failed(check, drift)) process.exitCode = 1;
}

export function renderCommand(opts: CommandOptions): Command {
  const cwd = opts.cwd ?? process.cwd();
  return new Command('render')
    .description('render a spec as a terminal map and/or a self-contained HTML map (business and release maps: HTML only)')
    .argument('<spec>', "spec JSON file, or '-' for stdin")
    .addOption(new Option('--output <mode>', 'override the output mode').choices(['auto', 'cli', 'web', 'both']))
    .addOption(new Option('--theme <theme>', 'HTML theme').choices(THEMES))
    .option('--open', 'open the HTML file in the browser')
    .option('--md', 'print a paste-ready markdown block (no color)')
    .option('--pr', 'print a collapsed section for a PR or MR description and write the map as an SVG (maps only)')
    .option('--svg <file>', 'with --pr: write the SVG here instead of the private cache folder')
    .option('--image-url <url>', 'with --pr: where the description loads the SVG from (default: its file name)')
    .option('--at <rev>', 'check anchors and node paths against the files at this commit instead of the working tree')
    .option('--git', "check a summary's new, changed and removed claims against staged, unstaged and untracked files")
    .option('--commit <sha>', 'check claims against the files one commit changed')
    .option('--since <base>', 'check claims against the files committed since <base>; add --git for uncommitted ones too')
    .option('--head <ref>', 'with --since: compare <base>...<ref> instead of HEAD')
    .option('--tech <file>', "business maps: the tech map's spec file, whose boxes the business map links to (default: the newest saved map on this branch)")
    .option('--pdf <file>', 'release maps: where to write the PDF (default: next to the HTML page)')
    .option('--strict', "exit 1 when a claim doesn't match the code or the build drifted from the plan without a reason")
    .action(async (arg: string, o: RenderFlags, cmd: Command) => {
      const usage = renderSelectionError(o) ?? (!o.pr && (o.svg !== undefined || o.imageUrl !== undefined) ? '--svg and --image-url need --pr' : undefined);
      if (usage) cmd.error(usage, { exitCode: 2 });
      try {
        await renderSpec(arg, o, opts, cwd);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const lines = e instanceof InvalidSpec ? e.errors : message.split('\n').map((l) => `codechart: ${l}`);
        opts.stderr(lines.map((l) => `${l}\n`).join(''));
        process.exitCode = e instanceof UsageError ? 2 : 1;
      }
    });
}
