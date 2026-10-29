import { isPlannedLink, type FlowLink, type FlowSpec, type FlowStep } from '../../spec/flow.js';
import { markdownBlock } from '../markdown.js';
import { columns, fit, flat, truncate, wrapItems, type Cuts, type Segment } from '../terminal/wrap.js';
import { defaultWidth, fullMapLine, MIN_WIDTH } from '../terminal/render.js';
import { walkFlow, type Arm, type Chain, type Item } from './walk.js';

export interface FlowTreeOptions {
  maxNodes: number;
  width?: number;
  color: boolean;
  md?: boolean;
  htmlPath?: string;
}

type Status = FlowStep['status'];

export const FLOW_KEY = 'key: + new  ~ changed  ? planned  ◇ decision  ⤷ shared step';
const MARKER: Record<Status, string> = { existing: '', new: '+', changed: '~', planned: '?' };
const SGR: Record<Status, string | undefined> = { existing: undefined, new: '32', changed: '33', planned: '35' };

interface Ctx {
  width: number;
  color: boolean;
  cuts: Cuts;
  htmlPath?: string;
  spec: FlowSpec;
}

const painter = (status: Status, ctx: Ctx) =>
  ctx.color && SGR[status] ? (text: string) => (text ? `\u001b[${SGR[status]}m${text}\u001b[0m` : text) : undefined;

const stepSegment = (step: FlowStep, ctx: Ctx): Segment => ({
  text: MARKER[step.status] + flat(step.label),
  paint: painter(step.status, ctx),
});

const cutText = (hidden: number, ctx: Ctx): string =>
  hidden > 0 ? `… (+${hidden} steps ${ctx.htmlPath ? 'in web view' : 'not shown'})` : '…';

function itemSegments(item: Item, ctx: Ctx): Segment[] {
  if (item.kind === 'cut') return [{ text: cutText(item.hidden, ctx) }];
  const label = stepSegment(item.step, ctx);
  return item.kind === 'ref' ? [{ text: '⤷ ' }, label] : [label];
}

const segWidth = (segments: Segment[]): number => columns(segments.map((s) => s.text).join(''));

/** A straight arrow gets `?` only when its own `planned` flag is the sole sign: planned ends already carry `?`. */
const markedLink = (link: FlowLink, ctx: Ctx): boolean =>
  link.planned === true && !endsPlanned(ctx.spec, link);

const endsPlanned = (spec: FlowSpec, link: FlowLink): boolean =>
  spec.steps.some((s) => s.status === 'planned' && (s.id === link.from || s.id === link.to));

/** Items joined with ` → `, breaking between items onto `→` lines indented under the run. */
function runLines(items: Item[], first: Segment[], rest: string, ctx: Ctx): string[] {
  const lines: Segment[][] = [];
  let line = first;
  items.forEach((item, i) => {
    const segs = itemSegments(item, ctx);
    const mark = item.via && markedLink(item.via, ctx) ? '?' : '';
    const arrow: Segment = { text: `${mark}→ `, paint: mark ? painter('planned', ctx) : undefined };
    if (i === 0) {
      line = [...line, ...segs];
    } else if (segWidth(line) + segWidth(segs) + 2 + columns(arrow.text) <= ctx.width) {
      line = [...line, { text: ' ' }, arrow, ...segs];
    } else {
      lines.push(line);
      line = [{ text: `${rest}  ` }, arrow, ...segs];
    }
  });
  lines.push(line);
  return lines.map((l) => fit(l, ctx.width, ctx.cuts));
}

function armLines(arms: Arm[], rest: string, ctx: Ctx): string[] {
  const planned = arms.map(({ link }) => isPlannedLink(ctx.spec, link));
  const labels = arms.map(({ link }, i) => (planned[i] ? '?' : '') + flat(link.label ?? ''));
  // Align branch targets, but don't let one long label push every target far right.
  const pad = Math.min(Math.max(...labels.map(columns)), Math.floor(ctx.width / 3));
  return arms.flatMap((arm, i) => {
    const last = i === arms.length - 1;
    const glyph = last ? '└─ ' : '├─ ';
    const label = truncate(labels[i]!, pad, ctx.cuts);
    const head: Segment[] = [{ text: rest + glyph }];
    if (pad > 0) {
      const paint = planned[i] ? painter('planned', ctx) : undefined;
      head.push({ text: label, paint }, { text: `${' '.repeat(pad - columns(label))} → ` });
    }
    const under = `${rest}${last ? '   ' : '│  '}${pad > 0 ? ' '.repeat(pad + 3) : ''}`;
    return chainLines(arm.chain, head, under, '', ctx);
  });
}

function chainLines(chain: Chain, first: Segment[], rest: string, lead: string, ctx: Ctx): string[] {
  const lines: string[] = [];
  let prefix = [...first, { text: lead }];
  if (chain.items.length > 0) {
    lines.push(...runLines(chain.items, prefix, rest, ctx));
    prefix = [{ text: rest }];
  }
  if (chain.branch) {
    const { head, arms } = chain.branch;
    const glyph = head.type === 'decision' ? '◇ ' : '';
    lines.push(fit([...prefix, { text: glyph }, stepSegment(head, ctx)], ctx.width, ctx.cuts));
    lines.push(...armLines(arms, rest, ctx));
  }
  return lines;
}

function footer(spec: FlowSpec, ctx: Ctx, md: boolean): string {
  const count = (status: Status) => spec.steps.filter((s) => s.status === status).length;
  const lines = [
    truncate(
      `${spec.steps.length} steps · ${count('new')} new · ${count('changed')} changed · ${count('planned')} planned`,
      ctx.width,
    ),
  ];
  if (!md) lines.push(truncate(FLOW_KEY, ctx.width));
  if (spec.gaps?.length) lines.push(wrapItems('gaps: ', spec.gaps.map(flat), ctx.width));
  // Never broken: a split URL stops being clickable.
  if (ctx.htmlPath && !md) lines.push(fullMapLine(ctx.htmlPath));
  return lines.join('\n');
}

// The title sits inside the fence: no Markdown escapes for an agent to "fix" when pasting, and none of it takes effect.
export function flowMarkdown(title: string, tree: string | undefined, htmlPath: string | undefined, width: number, cuts?: Cuts): string {
  const heading = truncate(flat(title), Math.max(width, MIN_WIDTH), cuts);
  const titled = `${heading}\n${'─'.repeat(columns(heading))}`;
  return markdownBlock(`**Flow** _(${FLOW_KEY})_`, tree === undefined ? titled : `${titled}\n${tree}`, htmlPath);
}

const TOO_LARGE = 'flow too large for the terminal; use --output both or web';

/** `truncated`: text was cut with `…`, or steps were left out of the tree. Empty tree: only the link, or TOO_LARGE. */
export function renderFlowTree(spec: FlowSpec, opts: FlowTreeOptions): { text: string; truncated: boolean } {
  const ctx: Ctx = {
    width: Math.max(opts.width ?? defaultWidth(), MIN_WIDTH),
    color: opts.color && !opts.md,
    cuts: { truncated: false },
    htmlPath: opts.htmlPath,
    spec,
  };
  const walk = walkFlow(spec, opts.maxNodes);
  const md = opts.md ?? false;
  if (walk.blocks.length === 0) {
    if (!opts.htmlPath) return { text: md ? flowMarkdown(spec.title, TOO_LARGE, undefined, ctx.width) : `${TOO_LARGE}\n`, truncated: true };
    return { text: md ? flowMarkdown(spec.title, undefined, opts.htmlPath, ctx.width) : `${fullMapLine(opts.htmlPath)}\n`, truncated: true };
  }

  const blocks = walk.blocks.map((b) => chainLines(b.chain, [], '', b.shared ? '⤷ ' : '', ctx).join('\n'));
  if (spec.kind === 'plan' && (spec.steps.some((s) => s.status === 'planned') || spec.links.some((l) => isPlannedLink(spec, l)))) {
    blocks[0] = `${truncate('planned flow', ctx.width)}\n${blocks[0]}`;
  }
  if (walk.unreachable > 0) blocks[blocks.length - 1] += `\n${truncate(cutText(walk.unreachable, ctx), ctx.width, ctx.cuts)}`;
  const tree = [...blocks, footer(spec, ctx, md)].join('\n\n');
  const text = md ? flowMarkdown(spec.title, tree, opts.htmlPath, ctx.width, ctx.cuts) : `${tree}\n`;
  return { text, truncated: walk.truncated || ctx.cuts.truncated };
}
