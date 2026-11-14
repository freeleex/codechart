import type { Spec, SpecNode, Status } from '../spec/schema.js';
import type { MapCheck } from './check.js';
import { checkHeadline, type Mismatch } from './terminal/check-lines.js';
import { marker } from './terminal/labels.js';
import { flat } from './terminal/wrap.js';
import { MEANING, UNCHECKED_WHY, UNCOVERED_WHY } from './web/check-html.js';
import { fieldText, nodeWhat, viewport } from './web/html.js';
import type { Layout } from './web/layout.js';
import { arrowMarker, CHANGE_ARROWS, esc, num } from './web/page.js';
import { CSS } from './web/styles.js';

const PAD = 10;

/**
 * The map as one standalone SVG, drawn like the HTML page. Loaded as an image it runs no script,
 * and the page's CSS still applies: `:root` is the `<svg>`, so it follows the viewer's light or dark mode.
 */
export function renderSvg(spec: Spec, layout: Layout, check: MapCheck | undefined): string {
  const w = num(layout.width + 2 * PAD);
  const h = num(layout.height + 2 * PAD);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" data-theme="auto" viewBox="${-PAD} ${-PAD} ${w} ${h}" width="${w}" height="${h}" font-family="system-ui,sans-serif" font-size="13">` +
    `<title>${esc(spec.title)}</title><style>${CSS}</style>` +
    `<defs>${arrowMarker('arrow')}${CHANGE_ARROWS}</defs>` +
    `<rect x="${-PAD}" y="${-PAD}" width="${w}" height="${h}" style="fill:var(--bg)"/>` +
    `${viewport(spec, layout, check, undefined, { plain: true })}</svg>\n`
  );
}

/** Text for Markdown: no HTML, nothing that opens a code span, and no `~` strikethrough (it also stops `**~ x**` going bold); backslashes too, so `\~` cannot undo it, and brackets, which would end a link or image text. */
const md = (s: string): string => esc(flat(s)).replace(/`/g, "'").replace(/[\\~[\]]/g, '\\$&');

const nodeName = (n: SpecNode): string => md(`${marker(n.status)} ${n.label}`.trimStart());

function mismatchGroups(mismatches: Mismatch[], byId: Map<string, SpecNode>): string[] {
  const groups = new Map<string, Mismatch[]>();
  for (const m of mismatches) groups.set(m.short, [...(groups.get(m.short) ?? []), m]);
  return [...groups].map(([short, ms]) => {
    const names = ms.map((m) => (byId.has(m.id) ? nodeName(byId.get(m.id)!) : md(m.label))).join(', ');
    const meaning = MEANING[short] ? ` ${MEANING[short]}` : '';
    return `- **✗ ${md(short)}** (${ms.length}): ${names}.${meaning}`;
  });
}

function checkLines(spec: Spec, check: MapCheck | undefined): string[] {
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const lines = check?.mismatches.length ? mismatchGroups(check.mismatches, byId) : [];
  if (check?.uncovered?.length) lines.push(`- **✗ Changed, not on map** (${check.uncovered.length}): ${fileList(check.uncovered)}. ${UNCOVERED_WHY}`);
  if (check?.diffUnchecked) lines.push(`- **Diff not checked.** ${UNCHECKED_WHY}`);
  if (spec.omitted?.length) lines.push(`- **Left out on purpose:** ${spec.omitted.map(md).join('; ')}`);
  if (spec.gaps?.length) lines.push(`- **Not read by the agent:** ${spec.gaps.map(md).join('; ')}`);
  return lines;
}

function nodeDetail(n: SpecNode, check: MapCheck | undefined): string {
  const head = `- **${nodeName(n)}** · ${nodeWhat(n)}${n.path ? ` · \`${flat(n.path).replace(/`/g, '')}\`` : ''}`;
  const lines: string[] = [];
  const m = check?.mismatches.find((x) => x.id === n.id);
  if (m) lines.push(`✗ ${md(m.detail)}`);
  if (n.summary) lines.push(md(n.summary));
  if (n.fields?.length) lines.push(`Fields: ${n.fields.map((f) => md(fieldText(f))).join(' · ')}${n.fieldsComplete === false ? ' (only the ones the agent saw)' : ''}`);
  for (const note of n.notes ?? []) lines.push(`Note: ${md(note)}`);
  return [head, ...lines.map((l) => `  - ${l}`)].join('\n');
}

const MAX_FILES = 8;

const fileList = (files: string[]): string => {
  const shown = files.slice(0, MAX_FILES).map((f) => `\`${flat(f).replace(/`/g, '')}\``);
  return [...shown, ...(files.length > MAX_FILES ? [`+${files.length - MAX_FILES} more`] : [])].join(', ');
};

const STATUS_ORDER: Status[] = ['new', 'changed', 'removed', 'config', 'context'];

const KEY = STATUS_ORDER.map((s) => `${marker(s)} ${s}`.trimStart()).join(' · ');

export const BLOCK_START = '<!-- codechart:start -->';
export const BLOCK_END = '<!-- codechart:end -->';
export const SPEC_OPEN = '<!-- codechart spec';

// `-->` or `--!>` inside a JSON string would end the HTML comment early.
const specComment = (spec: Spec): string =>
  `${SPEC_OPEN}\n${JSON.stringify(spec).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}\n-->`;

/** `url` as a Markdown link target: spaces and parentheses would end it. */
export const imageHref = (url: string): string => encodeURI(url).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** The collapsed section an agent or CI puts in a PR or MR description, around the map image at `imageUrl`. */
export function prBlock(spec: Spec, check: MapCheck | undefined, imageUrl: string): string {
  const count = (s: Status) => spec.nodes.filter((n) => n.status === s).length;
  const counts = [`${spec.nodes.length} nodes`, `${count('new')} new`, `${count('changed')} changed`, ...(count('removed') ? [`${count('removed')} removed`] : [])].join(' · ');
  const url = imageHref(imageUrl);
  const nodes = [...spec.nodes].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  const parts = [
    BLOCK_START,
    `<details><summary>Map: ${esc(flat(spec.title))}</summary>`,
    '',
    [counts, checkHeadline(check)].filter(Boolean).join(' · '),
    '',
    `[![${md(spec.title)}](${url})](${url})`,
  ];
  const checks = checkLines(spec, check);
  if (checks.length) parts.push('', ...checks);
  parts.push(
    '',
    `<details><summary>Node details (${spec.nodes.length})</summary>`,
    '',
    nodes.map((n) => nodeDetail(n, check)).join('\n'),
    '',
    '</details>',
    '',
    `Key: ${KEY}. Interactive map with code previews: run \`codechart\` locally.`,
    '',
    '</details>',
    '',
    specComment(spec),
    BLOCK_END,
  );
  return `${parts.join('\n')}\n`;
}
