import { chmodSync, constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { Command, Option } from 'commander';
import { findRepoRoot, loadConfig } from '../config/load.js';
import { THEMES, type Config, type Diagram, type Output, type Theme } from '../config/schema.js';
import type { CommandOptions } from '../program.js';
import { checkFlowDiff, checkMapNodes, diffOf, type Diff } from '../render/check.js';
import { checkFlowAnchors } from '../render/flow/anchors.js';
import { markdownBlock, openBlockedNote } from '../render/markdown.js';
import { fileSlug, htmlOutputPath, needsWeb, repoFolder } from '../render/output-path.js';
import { nodePreviews } from '../render/preview.js';
import { pruneHtml } from '../render/prune.js';
import { alertLine, type CheckSummary } from '../render/terminal/check-lines.js';
import { defaultWidth, fullMapLine, KEY, renderTerminalDetailed } from '../render/terminal/render.js';
import { selectTerminalNodes } from '../render/terminal/select.js';
import { renderHtml } from '../render/web/html.js';
import { layoutSpec } from '../render/web/layout.js';
import type { HtmlMeta } from '../render/web/page.js';
import { resolveCommit } from '../rules/git-files.js';
import { unionOutputs } from '../rules/resolve.js';
import { diffRange, gitFiles, hasGitSelection, selectionError, type GitSelection } from '../rules/selection.js';
import type { FlowSpec } from '../spec/flow.js';
import { validateSpec, type Spec } from '../spec/schema.js';
import { MAX_SPEC_BYTES } from '../spec/shared.js';
import { inCodeEditor, openInBrowser } from './open.js';
import { renderFlow } from './render-flow.js';

class InvalidSpec extends Error {
  constructor(readonly errors: string[]) {
    super('invalid spec');
  }
}

const TOO_BIG = 'spec is larger than 2 MB';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += (chunk as Buffer).length;
    if (size > MAX_SPEC_BYTES) throw new Error(TOO_BIG);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

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

function flowAnchors(spec: FlowSpec, root: string, at: string | undefined, cwd: string) {
  const anchors = checkFlowAnchors(spec, root, at, cwd);
  if (!anchors.ok) throw new InvalidSpec(anchors.errors);
  return anchors;
}

interface RenderFlags extends GitSelection {
  output?: Exclude<Output, 'none'>;
  theme?: Theme;
  open?: boolean;
  md?: boolean;
  at?: string;
  strict?: boolean;
}

function renderSelectionError(o: RenderFlags): string | undefined {
  if (!hasGitSelection(o)) return undefined;
  if (o.head !== undefined && o.since === undefined) return '--head needs --since';
  if (o.commit !== undefined && (o.git || o.since !== undefined)) return '--commit does not combine with --git or --since';
  return selectionError(o);
}

function markdown(map: string | undefined, htmlPath: string | undefined, alert: string): string {
  const body = map !== undefined && htmlPath ? map.split('\n').filter((l) => l !== fullMapLine(htmlPath)).join('\n') : map;
  return markdownBlock(`**Map** _(${KEY})_`, body ?? (alert || undefined), htmlPath);
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
    .option('--at <rev>', 'check anchors and node paths against the files at this commit instead of the working tree')
    .option('--git', "check a summary's new, changed and removed claims against staged, unstaged and untracked files")
    .option('--commit <sha>', 'check claims against the files one commit changed')
    .option('--since <base>', 'check claims against the files committed since <base>; add --git for uncommitted ones too')
    .option('--head <ref>', 'with --since: compare <base>...<ref> instead of HEAD')
    .option('--strict', "exit 1 when a claim doesn't match the code")
    .action(async (arg: string, o: RenderFlags, cmd: Command) => {
      const usage = renderSelectionError(o);
      if (usage) cmd.error(usage, { exitCode: 2 });
      try {
        const spec = await readSpec(arg, cwd, opts.stdin ?? readStdin);
        const repoRoot = findRepoRoot(cwd);
        const root = repoRoot ?? resolve(cwd);
        let at: string | undefined;
        if (o.at !== undefined) {
          if (!repoRoot) throw new Error('--at needs a git repository');
          at = resolveCommit(root, '--at', o.at);
        }
        const anchors = spec.diagram === 'flow' ? flowAnchors(spec, root, at, resolve(cwd)) : undefined;
        let diff: Diff | undefined;
        if (hasGitSelection(o)) {
          if (!repoRoot) throw new Error('--git, --commit and --since need a git repository');
          diff = diffOf(gitFiles(root, o, true));
        }
        const config = loadConfig({ cwd, home: opts.home, env: opts.env, warn: (l) => opts.stderr(`codechart: ${l}\n`) });
        const diagram = spec.diagram ?? 'map';
        const resolved = spec.rules?.length ? specOutput(config, spec.rules, diagram) : config.defaults.output;
        const output = o.output ?? resolved;
        if (output === 'none') {
          const why = spec.rules?.length ? `its rules (${spec.rules.join(', ')}) resolve to output none` : 'defaults.output is none';
          opts.stderr(`codechart: no ${diagram} drawn: ${why}\n`);
          return;
        }

        const maxNodes = config.defaults.terminalMaxNodes;
        const color = !o.md && (opts.isTTY ?? process.stdout.isTTY === true);
        const width = defaultWidth(
          { isTTY: opts.isTTY ?? process.stdout.isTTY, columns: process.stdout.columns },
          opts.env ?? process.env,
        );
        // A blank line after --md output keeps two renders in one Bash call from gluing together.
        const print = (text: string) => opts.stdout(o.md ? `${text}\n` : text);
        const slug = fileSlug(spec.title, diagram);
        let blocked: string | undefined;
        const printBlocked = () => blocked && print(openBlockedNote(blocked, o.md === true));
        const writeHtml = async (build: (meta: HtmlMeta) => Promise<string>): Promise<string> => {
          const now = opts.now?.() ?? new Date();
          const file = htmlOutputPath(config, repoFolder(root), slug, now);
          const html = await build({ generatedAt: now, repo: basename(root), theme: o.theme ?? config.web.theme });
          if (lstatSync(dirname(file), { throwIfNoEntry: false })?.isSymbolicLink()) {
            throw new Error(`${dirname(file)}: is a symlink; refusing to write`);
          }
          mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
          chmodSync(dirname(file), 0o700);
          writeFileSync(file, html, { mode: 0o600 });
          pruneHtml(dirname(file), { ...config.web, now, replaceSlug: slug });
          const mode = config.web.open;
          if (o.open || mode === 'always' || (mode === 'auto' && inCodeEditor(opts.env ?? process.env))) {
            const failed = (opts.open ?? openInBrowser)(file);
            if (failed) {
              opts.stderr(`codechart: could not open the browser (${failed})\n`);
              blocked = file;
            }
          }
          return file;
        };

        const failStrict = (check: CheckSummary) => {
          if (o.strict && check.mismatches.length > 0) process.exitCode = 1;
        };

        if (spec.diagram === 'flow') {
          const check = checkFlowDiff(spec, anchors!.snippets, anchors!.checked, root, diff);
          const tree = { maxNodes, width, color, md: o.md, check };
          print(await renderFlow(spec, anchors!.snippets, { output, minNodes: config.web.minNodes, tree, writeHtml }));
          printBlocked();
          failStrict(check);
          return;
        }

        const check = checkMapNodes(spec, root, { at, cwd: resolve(cwd), diff });
        const { hidden } = selectTerminalNodes(spec, maxNodes);
        const termOpts = { maxNodes, keyLine: !o.md, color, width, check };
        const previews = () => (diff ? nodePreviews(spec, root, diff, diffRange(root, o), resolve(cwd)) : undefined);
        const writeMapHtml = () => writeHtml(async (meta) => renderHtml(spec, await layoutSpec(spec), meta, check, previews()));

        let htmlPath: string | undefined;
        let terminal: { text: string; truncated: boolean } | undefined;
        if (output === 'web' || output === 'both' || (output === 'auto' && needsWeb(spec, hidden, config.web.minNodes))) {
          htmlPath = await writeMapHtml();
        } else if (output === 'auto') {
          terminal = renderTerminalDetailed(spec, termOpts);
          if (terminal.truncated) {
            htmlPath = await writeMapHtml();
            terminal = undefined;
          }
        }

        const map = output === 'web' ? undefined : (terminal ?? renderTerminalDetailed(spec, { ...termOpts, htmlPath })).text;
        const alert = alertLine(check, width);
        if (o.md) print(markdown(map, htmlPath, alert));
        else print(map ?? `${alert ? `${alert}\n` : ''}${fullMapLine(htmlPath!)}\n`);
        printBlocked();
        failStrict(check);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const lines = e instanceof InvalidSpec ? e.errors : message.split('\n').map((l) => `codechart: ${l}`);
        opts.stderr(lines.map((l) => `${l}\n`).join(''));
        process.exitCode = 1;
      }
    });
}
