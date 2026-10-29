import { spawn } from 'node:child_process';
import { win32 } from 'node:path';

export function openArgv(platform: NodeJS.Platform, file: string, env: NodeJS.ProcessEnv = process.env): [string, string[]] {
  if (platform === 'darwin') return ['open', [file]];
  // cmd /c start would re-parse & ^ % in the path; a bare name would be looked up in the cwd first
  if (platform === 'win32') {
    return [win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'rundll32.exe'), ['url.dll,FileProtocolHandler', file]];
  }
  return ['xdg-open', [file]];
}

export function openInBrowser(file: string): void {
  const [cmd, args] = openArgv(process.platform, file);
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {
    // Opening is a convenience; the path is already printed.
  }
}
