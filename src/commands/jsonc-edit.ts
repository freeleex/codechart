import { findNodeAtLocation, type Node, parseTree } from 'jsonc-parser';

// Edits touch only the text of the changed item, so comments, commas and layout elsewhere stay byte for byte.

const splice = (text: string, from: number, to: number, insert: string) => text.slice(0, from) + insert + text.slice(to);
const lineStart = (text: string, at: number) => text.lastIndexOf('\n', at - 1) + 1;
const indentAt = (text: string, at: number) => /^[ \t]*/.exec(text.slice(lineStart(text, at)))![0];
const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');

/** The node at `path` of the document in `text`; call only on text that parses. */
export function nodeAt(text: string, path: (string | number)[]): Node | undefined {
  const root = parseTree(text, [], { allowTrailingComma: true });
  return root && findNodeAtLocation(root, path);
}

/** Replaces the string value at `path`. */
export function replaceString(text: string, path: (string | number)[], value: string): string {
  const node = nodeAt(text, path)!;
  return splice(text, node.offset, node.offset + node.length, JSON.stringify(value));
}

/** Adds `item` (an array element, or `"key": value` for an object) after the last child, matching the container's layout and trailing comma. */
export function appendItem(text: string, container: Node, item: string, unit: string): string {
  const kids = container.children ?? [];
  const last = kids.at(-1);
  const eol = eolOf(text);
  if (!last) {
    const inside = [container.offset + 1, container.offset + container.length - 1] as const;
    if (container.type === 'array') return splice(text, ...inside, item);
    const pad = indentAt(text, container.offset);
    return splice(text, ...inside, `${eol}${pad}${unit}${item}${eol}${pad}`);
  }
  const end = last.offset + last.length;
  if (!text.slice(container.offset, kids[0]!.offset).includes('\n')) return splice(text, end, end, `, ${item}`);
  const trailing = /^[ \t]*(,)?[ \t]*(?:\/\/[^\r\n]*|\/\*[^\r\n]*?\*\/)?/.exec(text.slice(end))!;
  const line = `${eol}${indentAt(text, last.offset)}${item}`;
  if (trailing[1]) return splice(text, end + trailing[0].length, end + trailing[0].length, `${line},`);
  return splice(splice(text, end + trailing[0].length, end + trailing[0].length, line), end, end, ',');
}

/** The comma in `text[from, to)`, skipping comments; -1 when there is none. */
function commaBetween(text: string, from: number, to: number): number {
  for (let i = from; i < to; i++) {
    if (text.startsWith('//', i)) i = text.indexOf('\n', i) - 1;
    else if (text.startsWith('/*', i)) i = text.indexOf('*/', i) + 1;
    else if (text[i] === ',') return i;
  }
  return -1;
}

/** Drops the line at `at` when the removal left it blank. */
function dropBlankLine(text: string, at: number): string {
  const from = lineStart(text, at);
  const nl = text.indexOf('\n', at);
  const to = nl < 0 ? text.length : nl;
  return /^[ \t\r]*$/.test(text.slice(from, to)) ? splice(text, from, Math.min(to + 1, text.length), '') : text;
}

/** Removes the `index`th child with its comma, keeping the others' commas valid and every comment. */
export function removeItem(text: string, container: Node, index: number): string {
  const kids = container.children!;
  const kid = kids[index]!;
  const end = kid.offset + kid.length;
  const next = kids[index + 1];
  const after = commaBetween(text, end, next ? next.offset : container.offset + container.length - 1);
  if (after >= 0) {
    if (/^[ \t]*$/.test(text.slice(end, after))) {
      const to = after + 1 + /^[ \t]*/.exec(text.slice(after + 1))![0].length;
      return dropBlankLine(splice(text, kid.offset, to, ''), kid.offset);
    }
    return dropBlankLine(splice(splice(text, after, after + 1, ''), kid.offset, end, ''), kid.offset);
  }
  const prev = kids[index - 1];
  const before = prev ? commaBetween(text, prev.offset + prev.length, kid.offset) : -1;
  if (before < 0) return dropBlankLine(splice(text, kid.offset, end, ''), kid.offset);
  if (/^[ \t]*$/.test(text.slice(before + 1, kid.offset))) return splice(text, before, end, '');
  return splice(dropBlankLine(splice(text, kid.offset, end, ''), kid.offset), before, before + 1, '');
}
