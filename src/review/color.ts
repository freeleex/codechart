const SGR = (code: string, s: string): string => `\u001b[${code}m${s}\u001b[0m`;

/** Colours the review document for a terminal, line by line: the same cues a diff-aware editor shows. */
export function colorDoc(doc: string): string {
  return doc
    .split('\n')
    .map((l) => {
      if (l.startsWith('## ')) return SGR('1', l);
      if (l.startsWith('#')) return SGR('2', l);
      if (l.startsWith('@@')) return SGR('36', l);
      if (l.startsWith('-')) return SGR('31', l);
      if (l.startsWith('+')) return SGR('32', l);
      if (/^ *>/.test(l)) return SGR('30;43', l);
      return l;
    })
    .join('\n');
}
