import { execFileSync } from 'node:child_process';
import { specInDescription } from './description.js';
import { gitRun } from './git.js';
import { parseRemote, repoArg, type Remote, type Tool } from './setup.js';
import { BLOCK_END, BLOCK_START } from '../render/pr.js';
import { sanitizeText } from '../render/strip.js';
import { toolEnv } from './tool-env.js';
import { type LogEntry } from '../rules/git-log.js';
import { trustedBinary } from '../rules/git-run.js';

const MAX_DESCRIPTION = 1500;

/** The PR or MR number a first-parent commit stands for: GitHub squash `(#12)`, GitHub merge commit, GitLab `!12`. */
export function prNumber({ subject, body }: Pick<LogEntry, 'subject' | 'body'>): number | undefined {
  const m = /\(#(\d+)\)\s*$/.exec(subject) ?? /^Merge pull request #(\d+)/.exec(subject) ?? /See merge request \S*?!(\d+)/.exec(body);
  return m ? Number(m[1]) : undefined;
}

/** The change's title: a GitHub merge commit's subject is boilerplate, its PR title is the first body line. */
export function changeTitle({ subject, body }: Pick<LogEntry, 'subject' | 'body'>): string {
  return /^Merge pull request #\d+/.test(subject) ? body.split('\n').find((l) => l.trim()) ?? subject : subject;
}

/** The forge behind origin; undefined without an origin remote or on an unknown host. */
export function originRemote(root: string): Remote | undefined {
  try {
    return parseRemote(gitRun(root, ['config', '--get', 'remote.origin.url']));
  } catch {
    return undefined;
  }
}

export interface PrInfo {
  title: string;
  description?: string;
  map?: unknown;
}

const clip = (s: string): string => (s.length > MAX_DESCRIPTION ? `${s.slice(0, MAX_DESCRIPTION).trimEnd()}…` : s);

function withoutMap(body: string): string {
  const start = body.indexOf(BLOCK_START);
  const end = body.indexOf(BLOCK_END, start);
  return start < 0 || end < 0 ? body : body.slice(0, start) + body.slice(end + BLOCK_END.length);
}

/** A PR or MR's title, its text without the codechart section, and the tech map hidden in that section. */
function prInfo(title: string, body: string): PrInfo {
  let map: unknown;
  try {
    map = specInDescription(body);
  } catch {
    // a broken spec only costs this PR its map
  }
  const description = clip(sanitizeText(withoutMap(body).replace(/\n{3,}/g, '\n\n').trim()));
  return { title: sanitizeText(title), ...(description ? { description } : {}), ...(map === undefined ? {} : { map }) };
}

/** Reads PR/MR `n` with gh or glab, in the repo `remote` names; throws when the tool can't. */
export function fetchPr(tool: Tool, remote: Remote, n: number): PrInfo {
  if (remote.host === 'github') {
    const j = JSON.parse(tool('gh', ['pr', 'view', String(n), '--repo', repoArg(remote), '--json', 'title,body'], remote.server)) as { title?: string; body?: string };
    return prInfo(j.title ?? '', j.body ?? '');
  }
  const j = JSON.parse(tool('glab', ['mr', 'view', String(n), '--repo', repoArg(remote), '--output', 'json'], remote.server)) as { title?: string; description?: string };
  return prInfo(j.title ?? '', j.description ?? '');
}

/** Runs gh or glab; its error says in a sentence why it could not. */
export const runTool: Tool = (command, args, server) => {
  let file: string;
  try {
    file = trustedBinary(command);
  } catch {
    throw new Error(`${command} is not installed`);
  }
  try {
    return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, maxBuffer: 16 * 1024 * 1024, env: toolEnv(command, server, process.env) });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`${command} is not installed`);
    // glab puts a bare ERROR banner line before the reason
    const stderr = String((e as { stderr?: unknown }).stderr ?? '').split('\n').map((l) => l.trim()).find((l) => l && l !== 'ERROR');
    throw new Error(`${command} failed${stderr ? `: ${stderr}` : ''}`);
  }
};
