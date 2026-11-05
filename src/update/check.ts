import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageFile } from '../assets.js';
import { privateDir } from '../render/web/write.js';

const REGISTRY = 'https://registry.npmjs.org/codechart/latest';
const DAY = 24 * 60 * 60 * 1000;
const VERSION = /^\d+\.\d+\.\d+$/;

export const currentVersion = (): string => (JSON.parse(readFileSync(packageFile('package.json'), 'utf8')) as { version: string }).version;

/** True when `a` is a later x.y.z release than `b`; anything else (pre-releases, junk) is never newer. */
export function isNewer(a: string, b: string): boolean {
  if (!VERSION.test(a) || !VERSION.test(b)) return false;
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x![i] !== y![i]) return x![i]! > y![i]!;
  return false;
}

/** The newest published version, or undefined when npm doesn't answer in time. */
export async function fetchLatest(fetchFn: typeof fetch, timeoutMs: number): Promise<string | undefined> {
  try {
    const res = await fetchFn(REGISTRY, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    const version = ((await res.json()) as { version?: unknown }).version;
    return typeof version === 'string' && VERSION.test(version) ? version : undefined;
  } catch {
    return undefined;
  }
}

export interface UpdateState {
  checkedAt?: number;
  latest?: string;
  /** When each kind of reader was last told, so each hears it at most once a day. */
  toldTerminal?: number;
  toldAgent?: number;
}

const stateFile = (cacheDir: string) => join(cacheDir, 'update-check.json');

export function readState(cacheDir: string): UpdateState {
  try {
    const raw = JSON.parse(readFileSync(stateFile(cacheDir), 'utf8')) as UpdateState;
    return typeof raw === 'object' && raw !== null ? raw : {};
  } catch {
    return {};
  }
}

export function writeState(cacheDir: string, state: UpdateState): void {
  try {
    privateDir(cacheDir);
    writeFileSync(stateFile(cacheDir), JSON.stringify(state), { mode: 0o600 });
  } catch {
    // A notice is never worth failing the command for.
  }
}

/** The newer version known from the last check, without going online; for the HTML header. */
export function knownUpdate(cacheDir: string, current = currentVersion()): string | undefined {
  const { latest } = readState(cacheDir);
  return latest && isNewer(latest, current) ? latest : undefined;
}

export interface NoticeContext {
  cacheDir: string;
  enabled: boolean;
  env: NodeJS.ProcessEnv;
  /** A person at a terminal rather than an agent reading the output. */
  terminal: boolean;
  now: number;
  fetch: typeof fetch;
  current?: string;
}

// npx always runs the newest version; CI has nobody to tell.
export function checkAllowed(c: Pick<NoticeContext, 'enabled' | 'env'>, installPath = packageFile('')): boolean {
  const e = c.env;
  return c.enabled && !e.CODECHART_NO_UPDATE_CHECK && !e.NO_UPDATE_NOTIFIER && !e.CI && !/[\\/]_npx[\\/]/.test(installPath);
}

/**
 * Looks up the newest version at most once a day (1 s budget) and returns the line to show, at most once a day
 * per kind of reader; undefined when there is nothing to say.
 */
export async function updateNotice(c: NoticeContext): Promise<string | undefined> {
  if (!checkAllowed(c)) return undefined;
  const state = readState(c.cacheDir);
  let changed = false;
  if (!state.checkedAt || c.now - state.checkedAt >= DAY) {
    changed = true;
    const latest = await fetchLatest(c.fetch, 1000);
    // Recorded even on failure, so an offline machine tries once a day, not on every run.
    Object.assign(state, { checkedAt: c.now }, latest ? { latest } : {});
  }
  const current = c.current ?? currentVersion();
  const told = c.terminal ? 'toldTerminal' : 'toldAgent';
  let line: string | undefined;
  if (state.latest && isNewer(state.latest, current) && c.now - (state[told] ?? 0) >= DAY) {
    state[told] = c.now;
    changed = true;
    line = c.terminal
      ? `codechart ${state.latest} is available (you have ${current}): run codechart update`
      : `codechart ${state.latest} is available (you have ${current}). Tell the user once: run \`codechart update\`.`;
  }
  if (changed) writeState(c.cacheDir, state);
  return line;
}
