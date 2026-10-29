// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

export const asText = (c: unknown): string =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((b: Json) => (typeof b?.text === 'string' ? b.text : '')).join('') : '';

export interface Grade {
  // Rendered outputs (the last one per spec title) and how many the reply contains byte for byte.
  outputs: number;
  pasted: number;
  // Hand-made **Map**/**Flow** lines in the reply: not a pasted header and not a prose sentence.
  extraHeaders: number;
  // Diagram blocks in the reply whose header line and fenced block appear in no render tool result, failed calls included.
  unrendered: number;
  // Non-trivial scenarios: the reply shows at least one rendered diagram verbatim.
  shown: boolean | null;
  firstRenderOk: boolean | null;
  // Only for the trivial scenario: no render attempted and no diagram shown.
  trivialSkip: boolean | null;
}

const LINK = String.raw`\[Open full map\]\([^\n]*\)`;
// The fence grows past any backtick run in the body; with output web there is no fence, only the link.
export const OUTPUT_RE = new RegExp(String.raw`^\*\*(Map|Flow)\*\* _\(key:[^\n]*\n(?:(\x60{3,})text\n[\s\S]*?\n\2(?:\n\n${LINK})?|\n${LINK})`, 'gm');
const HEADER_RE = /\*\*(Map|Flow)\*\*/;
const LABEL_LINE_RE = /^\s*(#+\s*)?\*\*(Map|Flow):?\*\*/;
const PROSE_MIN = 60;
const FENCE_RE = /^(`{3,})[^\n]*\n[\s\S]*?\n\1$/gm;
const DIAGRAM_HINT_RE = /\*\*(Map|Flow)\*\*|_\(key:/;
const BOX_RE = /[─│├└▶◇⤷]/;
export const RENDER_ERROR_RE = /^(\$|(steps|links|nodes|edges)\[\d+\]\S*|kind|title|start|rules|diagram|steps|links|nodes|edges): /m;

/** Outputs of one render call, keyed by diagram and spec title when the titles in `command` line up with them. */
export function renderOutputs(text: string, command = ''): Map<string, string> {
  const found = [...text.matchAll(OUTPUT_RE)];
  const titles = [...command.matchAll(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
  const out = new Map<string, string>();
  found.forEach((m, i) => {
    const title = titles.length === found.length ? titles[i]! : `#${m[0].split('\n')[2] ?? ''}`;
    out.set(`${m[1]}:${title}`, m[0]);
  });
  return out;
}

export function gradeRun(events: Json[], scenario: string): Grade {
  const reply: string = events.find((e) => e.type === 'result')?.result ?? '';
  const renders = new Map<string, string>();
  const results: { text: string; command: string; error: boolean }[] = [];
  for (const e of events) {
    for (const b of (e.message?.content ?? []) as Json[]) {
      const command: string = b.input?.command ?? '';
      if (e.type === 'assistant' && b.type === 'tool_use' && b.name === 'Bash' && /\bcodechart\s+render\b/.test(command)) renders.set(b.id, command);
      if (e.type === 'user' && b.type === 'tool_result' && renders.has(b.tool_use_id)) {
        const text = asText(b.content);
        results.push({ text, command: renders.get(b.tool_use_id)!, error: Boolean(b.is_error) || RENDER_ERROR_RE.test(text.replace(OUTPUT_RE, '')) });
      }
    }
  }
  const outputs = new Map<string, string>();
  const unrendered = [...reply.matchAll(FENCE_RE)].filter((m) => {
    const before = reply.slice(0, m.index).replace(/\n$/, '');
    const header = before.slice(before.lastIndexOf('\n') + 1);
    if (!DIAGRAM_HINT_RE.test(header) && !BOX_RE.test(m[0])) return false;
    return !results.some((r) => `\n${r.text}`.includes(`\n${header}\n${m[0]}`));
  }).length;
  for (const r of results) for (const [k, v] of renderOutputs(r.text, r.command)) outputs.set(k, v);
  const pasted = [...outputs.values()].filter((o) => reply.includes(o));
  const headers = new Set([...outputs.values()].map((o) => o.split('\n')[0]!));
  const extraHeaders = reply
    .split('\n')
    .filter((l) => LABEL_LINE_RE.test(l) && !headers.has(l) && l.replace(LABEL_LINE_RE, '').trim().length < PROSE_MIN).length;
  return {
    outputs: outputs.size,
    pasted: pasted.length,
    extraHeaders,
    unrendered,
    shown: scenario === '4-trivial' ? null : pasted.length > 0,
    firstRenderOk: results.length ? !results[0]!.error : null,
    trivialSkip: scenario === '4-trivial' ? results.length === 0 && !HEADER_RE.test(reply) : null,
  };
}

/** A run whose measurements cannot be trusted: no result event (timeout, crash), an error result or a non-zero exit. */
export const isIncomplete = (raw: Json): boolean => {
  const result = (raw.events as Json[] | undefined)?.find((e) => e.type === 'result');
  return !result || Boolean(result.is_error) || raw.exitCode !== 0;
};
