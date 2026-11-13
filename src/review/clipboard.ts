import { execFileSync } from 'node:child_process';
import { trustedBinary } from '../rules/git-run.js';

const READERS: Record<string, [string, string[]][]> = {
  darwin: [['pbpaste', []]],
  win32: [['powershell', ['-NoProfile', '-Command', 'Get-Clipboard']]],
};
const OTHER: [string, string[]][] = [
  ['wl-paste', ['--no-newline']],
  ['xclip', ['-selection', 'clipboard', '-o']],
  ['xsel', ['-b', '-o']],
];

const NO_CLIPBOARD = "Can't read the clipboard here. Pipe the copied review in instead: codechart feedback --import < review.txt";

interface ClipboardDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (p: string) => boolean;
  exec?: (file: string, args: string[]) => string;
}

/** The system clipboard's text, from the first tool of this platform that works; throws when none does. */
export function readClipboard(max = 1024 * 1024, deps: ClipboardDeps = {}): string {
  const exec = deps.exec ?? ((file: string, args: string[]) => execFileSync(file, args, { timeout: 3000, maxBuffer: max, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  for (const [cmd, args] of READERS[deps.platform ?? process.platform] ?? OTHER) {
    try {
      return exec(trustedBinary(cmd, deps.platform, deps.env, deps.exists), args);
    } catch {
      // try the next tool
    }
  }
  throw new Error(NO_CLIPBOARD);
}
