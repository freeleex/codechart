import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageFile } from '../assets.js';
import { privateDir } from '../render/web/write.js';
import { cleanBullet, fetchHighlights, notesLines, type Highlights } from './changelog.js';

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
export async function fetchLatest(fetchFn: typeof fetch, timeoutMs: number, url = REGISTRY): Promise<string | undefined> {
  try {
    const res = await fetchFn(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
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
  /** Skill copies installed with install-skill --dir, which update refreshes too. */
  skillDirs?: string[];
  /** What changed between the two versions in `highlightsFor` (`from..to`), from CHANGELOG.md. */
  highlights?: string[];
  highlightsMore?: boolean;
  highlightsFor?: string;
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

export const skillDirs = (state: UpdateState): string[] => (Array.isArray(state.skillDirs) ? state.skillDirs.filter((d) => typeof d === 'string') : []);

export function rememberSkillDir(cacheDir: string, dir: string): void {
  const state = readState(cacheDir);
  const dirs = skillDirs(state);
  if (!dirs.includes(dir)) writeState(cacheDir, { ...state, skillDirs: [...dirs, dir] });
}

/** The stored highlights for `version`; the file is plain JSON on disk, so each line is cleaned again. */
const span = (from: string, to: string) => `${from}..${to}`;

export function knownHighlights(state: UpdateState, from: string, to: string): Highlights | undefined {
  if (state.highlightsFor !== span(from, to) || !Array.isArray(state.highlights)) return undefined;
  const bullets = state.highlights.filter((b) => typeof b === 'string').map(cleanBullet).filter(Boolean).slice(0, 5);
  return bullets.length ? { bullets, more: state.highlightsMore === true } : undefined;
}

export const withHighlights = (state: UpdateState, from: string, to: string, h: Highlights | undefined): UpdateState =>
  h ? { ...state, highlights: h.bullets, highlightsMore: h.more, highlightsFor: span(from, to) } : state;

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
  const current = c.current ?? currentVersion();
  let changed = false;
  if (!state.checkedAt || c.now - state.checkedAt >= DAY) {
    changed = true;
    const latest = await fetchLatest(c.fetch, 1000);
    // Recorded even on failure, so an offline machine tries once a day, not on every run.
    Object.assign(state, { checkedAt: c.now }, latest ? { latest } : {});
    if (latest && isNewer(latest, current) && !knownHighlights(state, current, latest)) Object.assign(state, withHighlights(state, current, latest, await fetchHighlights(c.fetch, current, latest, 1000)));
  }
  const told = c.terminal ? 'toldTerminal' : 'toldAgent';
  let line: string | undefined;
  if (state.latest && isNewer(state.latest, current) && c.now - (state[told] ?? 0) >= DAY) {
    state[told] = c.now;
    changed = true;
    line = c.terminal
      ? [`codechart ${state.latest} is available (you have ${current}): run codechart update`, ...notesLines(knownHighlights(state, current, state.latest))].join('\n')
      : `codechart ${state.latest} is available (you have ${current}). Tell the user once: run \`codechart update\`.`;
  }
  if (changed) writeState(c.cacheDir, state);
  return line;
}
