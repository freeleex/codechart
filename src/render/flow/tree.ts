import { isPlannedLink, isRemovedLink, type FlowLink, type FlowSpec, type FlowStep } from '../../spec/flow.js';
import { markdownBlock } from '../markdown.js';
import type { TermCtx } from '../terminal/ctx.js';
import { columns, fit, flat, truncate, wrapItems, type Cuts, type Segment } from '../terminal/wrap.js';
import { defaultWidth, fullMapLine, MIN_WIDTH } from '../terminal/render.js';
import { walkFlow, type Arm, type Chain, type Item } from './walk.js';
import { alertLine, countLines, type CheckSummary } from '../terminal/check-lines.js';

export interface FlowTreeOptions {
  maxNodes: number;
  width?: number;
  color: boolean;
  md?: boolean;
  htmlPath?: string;
  check?: CheckSummary;
}

type Status = FlowStep['status'];

export const FLOW_KEY = 'key: + new  ~ changed  ? planned  ◇ decision  ⤷ shared step';
// Only a plan that removes something pays for the longer key.
export const flowKey = (spec: FlowSpec): string => (hasRemoved(spec) ? FLOW_KEY.replace('? planned', '? planned  - removed') : FLOW_KEY);
const hasRemoved = (spec: FlowSpec) => spec.steps.some((s) => s.status === 'removed') || spec.links.some((l) => l.removed === true);
const MARKER: Record<Status, string> = { existing: '', new: '+', changed: '~', planned: '?', removed: '-' };
export const stepLabel = (step: FlowStep): string => MARKER[step.status] + flat(step.label);
const SGR: Record<Status, string | undefined> = { existing: undefined, new: '32', changed: '33', planned: '35', removed: '31' };

interface Ctx extends TermCtx {
  spec: FlowSpec;
}

const painter = (status: Status, ctx: Ctx) =>
  ctx.color && SGR[status] ? (text: string) => (text ? `\u001b[${SGR[status]}m${text}\u001b[0m` : text) : undefined;

const stepSegment = (step: FlowStep, ctx: Ctx): Segment => ({
  text: stepLabel(step),
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

/** A straight arrow gets `?` or `-` only when its own flag is the sole sign: marked ends already carry one. */
function linkMark(link: FlowLink, ctx: Ctx): '?' | '-' | '' {
  if (link.removed === true && !endsAre(ctx.spec, link, 'removed')) return '-';
  return link.planned === true && !endsAre(ctx.spec, link, 'planned') ? '?' : '';
}

const endsAre = (spec: FlowSpec, link: FlowLink, status: Status): boolean =>
  spec.steps.some((s) => s.status === status && (s.id === link.from || s.id === link.to));

/** Items joined with ` → `, breaking between items onto `→` lines indented under the run. */
function runLines(items: Item[], first: Segment[], rest: string, ctx: Ctx): string[] {
  const lines: Segment[][] = [];
  let line = first;
  items.forEach((item, i) => {
    const segs = itemSegments(item, ctx);
    const mark = item.via ? linkMark(item.via, ctx) : '';
    const arrow: Segment = { text: `${mark}→ `, paint: mark ? painter(mark === '-' ? 'removed' : 'planned', ctx) : undefined };
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
  const tones = arms.map(({ link }): Status | undefined =>
    isRemovedLink(ctx.spec, link) ? 'removed' : isPlannedLink(ctx.spec, link) ? 'planned' : undefined,
  );
  const labels = arms.map(({ link }, i) => (tones[i] ? MARKER[tones[i]] : '') + flat(link.label ?? ''));
  // Align branch targets, but don't let one long label push every target far right.
  const pad = Math.min(Math.max(...labels.map(columns)), Math.floor(ctx.width / 3));
  return arms.flatMap((arm, i) => {
    const last = i === arms.length - 1;
    const glyph = last ? '└─ ' : '├─ ';
    const label = truncate(labels[i]!, pad, ctx.cuts);
    const head: Segment[] = [{ text: rest + glyph }];
    if (pad > 0) {
      const paint = tones[i] ? painter(tones[i], ctx) : undefined;
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
    countLines(
      `${spec.steps.length} steps · ${count('new')} new · ${count('changed')} changed · ${count('planned')} planned${count('removed') ? ` · ${count('removed')} removed` : ''}`,
      ctx.check,
      ctx.width,
    ),
  ];
  if (!md) lines.push(truncate(flowKey(spec), ctx.width));
  if (spec.gaps?.length) lines.push(wrapItems('gaps: ', spec.gaps.map(flat), ctx.width));
  // Never broken: a split URL stops being clickable.
  if (ctx.htmlPath && !md) lines.push(fullMapLine(ctx.htmlPath));
  return lines.join('\n');
}

// The title sits inside the fence: no Markdown escapes for an agent to "fix" when pasting, and none of it takes effect.
export function flowMarkdown(title: string, tree: string | undefined, ctx: Pick<TermCtx, 'width' | 'htmlPath'> & { cuts?: Cuts }, key = FLOW_KEY): string {
  const heading = truncate(flat(title), Math.max(ctx.width, MIN_WIDTH), ctx.cuts);
  const titled = `${heading}\n${'─'.repeat(columns(heading))}`;
  return markdownBlock(`**Flow** _(${key})_`, tree === undefined ? titled : `${titled}\n${tree}`, ctx.htmlPath);
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
    check: opts.check,
  };
  const walk = walkFlow(spec, opts.maxNodes);
  const md = opts.md ?? false;
  const alert = alertLine(opts.check, ctx.width);
  if (walk.blocks.length === 0) {
    const body = (line: string) => (alert ? `${alert}\n${line}` : line);
    if (!opts.htmlPath) return { text: md ? flowMarkdown(spec.title, body(TOO_LARGE), ctx, flowKey(spec)) : `${body(TOO_LARGE)}\n`, truncated: true };
    const text = md ? flowMarkdown(spec.title, alert || undefined, ctx, flowKey(spec)) : `${body(fullMapLine(opts.htmlPath))}\n`;
    return { text, truncated: true };
  }

  const blocks = walk.blocks.map((b) => chainLines(b.chain, [], '', b.shared ? '⤷ ' : '', ctx).join('\n'));
  if (spec.kind === 'plan' && (spec.steps.some((s) => s.status === 'planned') || spec.links.some((l) => isPlannedLink(spec, l)))) {
    blocks[0] = `${truncate('planned flow', ctx.width)}\n${blocks[0]}`;
  }
  if (walk.unreachable > 0) blocks[blocks.length - 1] += `\n${truncate(cutText(walk.unreachable, ctx), ctx.width, ctx.cuts)}`;
  const tree = [...(alert ? [alert] : []), ...blocks, footer(spec, ctx, md)].join('\n\n');
  const text = md ? flowMarkdown(spec.title, tree, ctx, flowKey(spec)) : `${tree}\n`;
  return { text, truncated: walk.truncated || ctx.cuts.truncated };
}
