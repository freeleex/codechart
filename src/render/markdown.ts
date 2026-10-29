import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const longestTicks = (s: string): number => Math.max(0, ...(s.match(/`+/g) ?? []).map((run) => run.length));

/** `header`, then `body` in a fenced `text` block, then a link to the HTML when one was written. */
export function markdownBlock(header: string, body: string | undefined, htmlPath: string | undefined): string {
  const lines = [header];
  if (body !== undefined) {
    const fence = '`'.repeat(Math.max(3, longestTicks(body) + 1));
    lines.push(`${fence}text\n${body.trimEnd()}\n${fence}`);
  }
  if (htmlPath) {
    const href = pathToFileURL(resolve(htmlPath)).href;
    lines.push('', `[Open full map](${href.replace(/\(/g, '%28').replace(/\)/g, '%29')})`);
  }
  return `${lines.join('\n')}\n`;
}

// Sandboxed editors (e.g. Antigravity) may not let codechart launch a browser; give the address to paste instead.
export function openBlockedNote(htmlPath: string, md: boolean): string {
  const href = pathToFileURL(resolve(htmlPath)).href;
  const say = "Your editor didn't let codechart open the page. Paste this into your browser's address bar:";
  return md ? `${say}\n\n\`\`\`text\n${href}\n\`\`\`\n` : `${say}\n  ${href}\n`;
}
