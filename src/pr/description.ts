import { BLOCK_END, BLOCK_START, SPEC_OPEN } from '../render/pr.js';

/** The spec hidden in a description's codechart section, parsed; undefined when there is none. */
export function specInDescription(body: string): unknown {
  const start = body.indexOf(BLOCK_START);
  const end = body.indexOf(BLOCK_END, start);
  if (start < 0 || end < 0) return undefined;
  const open = body.indexOf(SPEC_OPEN, start);
  if (open < 0 || open > end) return undefined;
  const json = body.slice(open + SPEC_OPEN.length, body.lastIndexOf('-->', end)).trim();
  try {
    return JSON.parse(json);
  } catch {
    throw new Error('the codechart spec in the description is not valid JSON');
  }
}

/** `body` with its codechart section replaced by `block`; the text around it stays as written. */
export function replaceSection(body: string, block: string): string {
  const start = body.indexOf(BLOCK_START);
  const end = body.indexOf(BLOCK_END, start);
  if (start < 0 || end < 0) throw new Error('no codechart section in the description');
  return body.slice(0, start) + block.trimEnd() + body.slice(end + BLOCK_END.length);
}
