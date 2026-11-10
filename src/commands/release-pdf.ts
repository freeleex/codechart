import { execFile } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdtempSync, openSync, readSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';

const TIMEOUT_MS = 60_000;

const MAC = ['Google Chrome', 'Chromium', 'Microsoft Edge', 'Brave Browser'].map((n) => `/Applications/${n}.app/Contents/MacOS/${n}`);
const LINUX = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
const WINDOWS = [
  ['ProgramFiles', 'Google\\Chrome\\Application\\chrome.exe'],
  ['ProgramFiles(x86)', 'Google\\Chrome\\Application\\chrome.exe'],
  ['LOCALAPPDATA', 'Google\\Chrome\\Application\\chrome.exe'],
  ['ProgramFiles', 'Microsoft\\Edge\\Application\\msedge.exe'],
  ['ProgramFiles(x86)', 'Microsoft\\Edge\\Application\\msedge.exe'],
  ['LOCALAPPDATA', 'Microsoft\\Edge\\Application\\msedge.exe'],
] as const;

export interface BrowserLookup {
  /** `release.browser` */
  configured?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
}

/** Candidate paths, all absolute: a bare name would be looked up in the current folder (the repo) first on Windows. */
function candidates({ platform = process.platform, env = process.env }: BrowserLookup): string[] {
  if (platform === 'darwin') return MAC;
  if (platform === 'win32') return WINDOWS.flatMap(([base, rest]) => (env[base] ? [win32.join(env[base]!, rest)] : []));
  const dirs = (env.PATH ?? '').split(':').filter((d) => isAbsolute(d));
  return dirs.flatMap((d) => LINUX.map((n) => join(d, n)));
}

/** The browser that prints the PDF: `release.browser` when set (and then only it), else the first installed Chromium-family one. */
export function findBrowser(o: BrowserLookup = {}): string | undefined {
  const exists = o.exists ?? existsSync;
  const list = o.configured === undefined ? candidates(o) : [o.configured];
  return list.find((p) => exists(p));
}

/** The PDF's path from `--pdf` (absolute or relative to `cwd`); throws a message when it can't be written. */
export function pdfFlagPath(flag: string, cwd: string): string {
  const out = resolve(cwd, flag);
  if (!out.toLowerCase().endsWith('.pdf')) throw new Error('--pdf must end in .pdf');
  if (!statSync(dirname(out), { throwIfNoEntry: false })?.isDirectory()) throw new Error(`--pdf: ${dirname(out)} is not a folder`);
  return out;
}

export function browserArgs(html: string, pdf: string, profile: string): string[] {
  return ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, `--print-to-pdf=${pdf}`, pathToFileURL(html).href];
}

export type RunBrowser = (browser: string, args: string[]) => Promise<void>;

export const runBrowser: RunBrowser = (browser, args) =>
  new Promise((done, fail) => {
    execFile(browser, args, { timeout: TIMEOUT_MS, windowsHide: true }, (e) => (e ? fail(e) : done()));
  });

function isPdf(file: string): boolean {
  try {
    const fd = openSync(file, 'r');
    try {
      const head = Buffer.alloc(4);
      return readSync(fd, head, 0, 4, 0) === 4 && head.toString('latin1') === '%PDF';
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

/** Prints `html` to `pdf` with `browser`; resolves to an error message, or undefined once `pdf` is written and starts with `%PDF`. */
export async function printPdf(browser: string, html: string, pdf: string, run: RunBrowser = runBrowser): Promise<string | undefined> {
  const profile = mkdtempSync(join(tmpdir(), 'codechart-pdf-'));
  // Printed inside the throwaway profile, so a failed run never leaves a partial or old file at `pdf`.
  const printed = join(profile, 'release.pdf');
  try {
    await run(browser, browserArgs(html, printed, profile));
    if (!isPdf(printed)) return 'the browser finished but wrote no PDF';
    copyFileSync(printed, pdf);
    return undefined;
  } catch (e) {
    return (e as Error).message.split('\n')[0]!.slice(0, 200);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}
