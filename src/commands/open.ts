import { spawn, spawnSync } from 'node:child_process';
import { win32 } from 'node:path';

export function openArgv(platform: NodeJS.Platform, file: string, env: NodeJS.ProcessEnv = process.env): [string, string[]] {
  if (platform === 'darwin') return ['open', [file]];
  // cmd /c start would re-parse & ^ % in the path; a bare name would be looked up in the cwd first
  if (platform === 'win32') {
    return [win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'rundll32.exe'), ['url.dll,FileProtocolHandler', file]];
  }
  return ['xdg-open', [file]];
}

// VS Code-based editors (VS Code, Cursor, Windsurf, Antigravity) open file:// links as source, not in a browser.
export function inCodeEditor(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.VSCODE_PID) || env.TERM_PROGRAM === 'vscode';
}

// Returns an error message, or undefined when the opener started. The path is printed either way.
export function openInBrowser(file: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const [cmd, args] = openArgv(platform, file);
  try {
    if (platform === 'linux') {
      // xdg-open can block until the browser exits, so it is left running.
      spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
      return undefined;
    }
    // `open` and rundll32 return once the browser has the file. Waiting matters: agent shells such as
    // Antigravity's end leftover child processes as soon as codechart exits.
    const r = spawnSync(cmd, args, { stdio: 'ignore', timeout: 10_000 });
    // A slow cold start still opens the page; only real failures are reported.
    if ((r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') return undefined;
    if (r.error) return r.error.message;
    return r.status === 0 ? undefined : `${cmd} exited with ${r.status ?? r.signal}`;
  } catch (e) {
    return (e as Error).message;
  }
}
