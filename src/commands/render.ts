import { constants, closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { Command, Option } from 'commander';
import { findRepoRoot, loadConfig } from '../config/load.js';
import { THEMES, type Config, type Diagram, type Output, type Theme } from '../config/schema.js';
import type { CommandOptions } from '../program.js';
import { diffOf, type Diff } from '../render/check.js';
import { checkFlowAnchors, type FlowSnippets } from '../render/flow/anchors.js';
import { openBlockedNote } from '../render/markdown.js';
import { fileSlug, repoFolder } from '../render/output-path.js';
import { flagged } from '../render/terminal/check-lines.js';
import { defaultWidth } from '../render/terminal/render.js';
import { privateDir, writeHtml } from '../render/web/write.js';
import { resolveCommit } from '../rules/git-files.js';
import { unionOutputs, unmappedFiles } from '../rules/resolve.js';
import { gitFiles, hasGitSelection, selectionError, type GitSelection } from '../rules/selection.js';
import type { FlowSpec } from '../spec/flow.js';
import { validateSpec, type Spec } from '../spec/schema.js';
import { MAX_SPEC_BYTES } from '../spec/shared.js';
import type { RenderContext } from './choose-output.js';
import { inCodeEditor, openInBrowser } from './open.js';
import { renderFlow } from './render-flow.js';
import { renderMap } from './render-map.js';
import { readStdin } from './stdin.js';

class InvalidSpec extends Error {
  constructor(readonly errors: string[]) {
    super('invalid spec');
  }
}

const TOO_BIG = 'spec is larger than 2 MB';

function readSpecFile(file: string): string {
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    if (!fstatSync(fd).isFile()) throw new Error('not a regular file');
    const buf = Buffer.alloc(MAX_SPEC_BYTES + 1);
    let n = 0;
    for (let r = 1; r > 0 && n < buf.length; n += r) r = readSync(fd, buf, n, buf.length - n, null);
    if (n > MAX_SPEC_BYTES) throw new Error(TOO_BIG);
    return buf.toString('utf8', 0, n);
  } finally {
    closeSync(fd);
  }
}

function specOutput(config: Config, ruleNames: string[], diagram: Diagram): Output {
  const outputs = ruleNames.map((name) => {
    const rule = config.rules.find((r) => r.name === name);
    if (!rule) throw new Error(`unknown rule in spec: ${name}`);
    if ((rule.diagram ?? 'map') !== diagram) throw new Error(`rule in spec is not a ${diagram} rule: ${name}`);
    return rule.output ?? config.defaults.output;
  });
  return unionOutputs(outputs);
}

async function readSpec(arg: string, cwd: string, stdin: () => Promise<string>): Promise<Spec | FlowSpec> {
  const source = arg === '-' ? 'stdin' : resolve(cwd, arg);
  let raw: unknown;
  try {
    const text = arg === '-' ? await stdin() : readSpecFile(source);
    if (Buffer.byteLength(text) > MAX_SPEC_BYTES) throw new Error(TOO_BIG);
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`${source}: ${(e as Error).message}`);
  }
  const result = validateSpec(raw);
  if (!result.ok) throw new InvalidSpec(result.errors);
  return result.spec;
}

type Target = { diagram: 'flow'; spec: FlowSpec; snippets: FlowSnippets; checked: number } | { diagram: 'map'; spec: Spec };

function targetOf(spec: Spec | FlowSpec, root: string, at: string | undefined, cwd: string, pr: boolean): Target {
  if (spec.diagram !== 'flow') return { diagram: 'map', spec };
  if (pr) throw new Error('--pr draws maps only');
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
}

function renderSelectionError(o: RenderFlags): string | undefined {
  if (!hasGitSelection(o)) return undefined;
  if (o.head !== undefined && o.since === undefined) return '--head needs --since';
  if (o.commit !== undefined && (o.git || o.since !== undefined)) return '--commit does not combine with --git or --since';
  return selectionError(o);
}

function resolveAt(o: RenderFlags, repoRoot: string | undefined, root: string): string | undefined {
  if (o.at === undefined) return undefined;
  if (!repoRoot) throw new Error('--at needs a git repository');
  return resolveCommit(root, '--at', o.at);
}

function selectedDiff(o: RenderFlags, repoRoot: string | undefined, root: string): Diff | undefined {
  if (!hasGitSelection(o)) return undefined;
  if (!repoRoot) throw new Error('--git, --commit and --since need a git repository');
  return diffOf(gitFiles(root, o, true));
}

/** Without `--svg`, the image goes to the private cache folder: a fixed path in a shared temp dir could be a planted symlink. */
function prTarget(o: RenderFlags, cwd: string, cacheFile: string): RenderContext['pr'] {
  if (!o.pr) return undefined;
  if (o.svg !== undefined) return { svg: resolve(cwd, o.svg), imageUrl: o.imageUrl ?? basename(o.svg) };
  privateDir(dirname(cacheFile));
  return { svg: cacheFile, imageUrl: o.imageUrl ?? basename(cacheFile) };
}

async function renderSpec(arg: string, o: RenderFlags, opts: CommandOptions, cwd: string): Promise<void> {
  const spec = await readSpec(arg, cwd, opts.stdin ?? (() => readStdin(MAX_SPEC_BYTES, new Error(TOO_BIG))));
  const repoRoot = findRepoRoot(cwd);
  const root = repoRoot ?? resolve(cwd);
  const at = resolveAt(o, repoRoot, root);
  const target = targetOf(spec, root, at, resolve(cwd), o.pr === true);
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
  const slug = fileSlug(spec.title, target.diagram);
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
    write: (build) =>
      writeHtml(build, {
        config,
        root,
        slug,
        theme: o.theme ?? config.web.theme,
        now: opts.now?.() ?? new Date(),
        forceOpen: o.open === true,
        inEditor: inCodeEditor(env),
        open: opts.open ?? openInBrowser,
        stderr: opts.stderr,
      }),
  };
  const { text, check, html } = target.diagram === 'flow' ? await renderFlow(target.spec, target, ctx) : await renderMap(target.spec, ctx);
  // A blank line after --md output keeps two renders in one Bash call from gluing together.
  const print = (s: string) => opts.stdout(ctx.md ? `${s}\n` : s);
  print(text);
  if (html?.openFailed) print(openBlockedNote(html.file, ctx.md));
  if (o.strict && flagged(check)) process.exitCode = 1;
}

export function renderCommand(opts: CommandOptions): Command {
  const cwd = opts.cwd ?? process.cwd();
  return new Command('render')
    .description('render a spec as a terminal map and/or a self-contained HTML map')
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
    .option('--strict', "exit 1 when a claim doesn't match the code")
    .action(async (arg: string, o: RenderFlags, cmd: Command) => {
      const usage = renderSelectionError(o) ?? (!o.pr && (o.svg !== undefined || o.imageUrl !== undefined) ? '--svg and --image-url need --pr' : undefined);
      if (usage) cmd.error(usage, { exitCode: 2 });
      try {
        await renderSpec(arg, o, opts, cwd);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const lines = e instanceof InvalidSpec ? e.errors : message.split('\n').map((l) => `codechart: ${l}`);
        opts.stderr(lines.map((l) => `${l}\n`).join(''));
        process.exitCode = 1;
      }
    });
}
