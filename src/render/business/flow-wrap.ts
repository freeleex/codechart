const WIDE_LINES = 3;

/** Words on lines of at most `chars` characters; a word longer than that is broken, nothing is ever cut off. */
export function wrap(text: string, chars: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    for (let i = 0; i < word.length; i += chars) {
      const w = word.slice(i, i + chars);
      if (cur && cur.length + 1 + w.length <= chars) cur += ` ${w}`;
      else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
  }
  return cur ? [...lines, cur] : lines;
}

/** Lines of the narrowest width, from `base` up to `max` characters, that need three lines or fewer; past `max` the box gets taller instead. */
export function fit(text: string, base: number, max: number): string[] {
  for (let chars = base; chars < max; chars += 2) {
    const lines = wrap(text, chars);
    if (lines.length <= WIDE_LINES) return lines;
  }
  return wrap(text, max);
}
