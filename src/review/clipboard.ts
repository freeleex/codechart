import { execFileSync } from 'node:child_process';

const READERS: Record<string, [string, string[]][]> = {
  darwin: [['pbpaste', []]],
  win32: [['powershell', ['-NoProfile', '-Command', 'Get-Clipboard']]],
};
const OTHER: [string, string[]][] = [
  ['wl-paste', ['--no-newline']],
  ['xclip', ['-selection', 'clipboard', '-o']],
  ['xsel', ['-b', '-o']],
];

export const NO_CLIPBOARD = "Can't read the clipboard here. Pipe the copied review in instead: codechart feedback --import < review.txt";

/** The system clipboard's text, from the first tool of this platform that works; throws when none does. */
export function readClipboard(max = 1024 * 1024): string {
  for (const [cmd, args] of READERS[process.platform] ?? OTHER) {
    try {
      return execFileSync(cmd, args, { timeout: 3000, maxBuffer: max, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      // try the next tool
    }
  }
  throw new Error(NO_CLIPBOARD);
}
