import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { findRepoRoot } from '../config/load.js';
import { judgeTurn, nudge, saveSnapshot, SESSION_ID } from '../commands/hook-core.js';
import { recordPrompt, recordStop, turnsDir } from '../commands/hook-record.js';
import { type Message, viewTurn } from './turn.js';

interface Location {
  directory: string;
  workspaceID?: string;
}

interface SessionInfo {
  parentID?: string;
  outcome?: string;
  model?: { providerID?: string };
  location: Location;
  subpath?: string;
}

/** The slice of the OpenCode V2 plugin context this plugin uses. */
export interface Context {
  location: Location;
  session: {
    get: (input: { sessionID: string }) => Promise<SessionInfo>;
    context: (input: { sessionID: string }) => Promise<readonly Message[]>;
    synthetic: (input: { sessionID: string; text: string; metadata?: Record<string, unknown>; resume?: boolean }) => Promise<unknown>;
    hook: (name: 'prompt', callback: (event: { sessionID: string }) => Promise<void> | void) => Promise<{ dispose: () => Promise<void> }>;
  };
  event: {
    subscribe: (options: { types: string[]; signal: AbortSignal }) => AsyncIterable<{ data?: { sessionID?: string } }>;
  };
}

export interface Env {
  home?: string;
  now?: () => Date;
  debug?: boolean;
}

// OpenChamber's Claude Agent SDK sessions already run the ~/.claude hooks.
const CLAUDE_PROVIDER = 'claude-code';
const MAX_HANDLED = 500;

const rootOf = (s: SessionInfo) => findRepoRoot(join(s.location.directory, s.subpath ?? ''));

const sameLocation = (a: Location, b: Location) => resolve(a.directory) === resolve(b.directory) && a.workspaceID === b.workspaceID;

interface State {
  ctx: Context;
  dir: string;
  now: () => Date;
  fail: (what: string, e: unknown) => void;
  /** `session:user message` keys already judged. */
  handled: Set<string>;
  running: Set<string>;
}

const turnFile = (s: State, sessionID: string) => join(s.dir, `${sessionID}.json`);

async function onPrompt(s: State, sessionID: string): Promise<void> {
  if (!SESSION_ID.test(sessionID)) return;
  const root = rootOf(await s.ctx.session.get({ sessionID }));
  if (!root) return;
  const at = s.now();
  try {
    saveSnapshot(s.dir, turnFile(s, sessionID), root, at);
  } finally {
    try {
      recordPrompt(s.dir, root, sessionID, at.toISOString(), 'opencode');
    } catch (e) {
      s.fail('record', e);
    }
  }
}

async function check(s: State, sessionID: string): Promise<void> {
  if (!SESSION_ID.test(sessionID)) return;
  const session = await s.ctx.session.get({ sessionID });
  if (session.parentID || !sameLocation(session.location, s.ctx.location)) return;
  const turn = viewTurn(await s.ctx.session.context({ sessionID }));
  if (!turn || (turn.outcome ?? session.outcome) !== 'succeeded') return;
  if ((session.model?.providerID ?? turn.providerID) === CLAUDE_PROVIDER) return;
  const key = `${sessionID}:${turn.userID}`;
  if (turn.nudged || s.handled.has(key)) return;
  if (s.handled.size >= MAX_HANDLED) s.handled.clear();
  s.handled.add(key);
  const root = rootOf(session);
  if (!root) return;
  const outcome = judgeTurn(root, turnFile(s, sessionID), turn.reply, () => turn);
  if (outcome.decision === 'nudged') {
    await s.ctx.session.synthetic({ sessionID, text: nudge(outcome.files?.length ?? 0), metadata: { codechart: 'nudge' }, resume: true });
  }
  try {
    recordStop(s.dir, { at: s.now().toISOString(), root, session: sessionID, decision: outcome.decision, files: outcome.files, cli: turn.cli, agent: 'opencode' });
  } catch (e) {
    s.fail('record', e);
  }
}

async function onIdle(s: State, sessionID: string): Promise<void> {
  if (s.running.has(sessionID)) return;
  s.running.add(sessionID);
  try {
    await check(s, sessionID);
  } catch (e) {
    s.fail('idle', e);
  } finally {
    s.running.delete(sessionID);
  }
}

export function createHandlers(ctx: Context, env: Env = {}) {
  const s: State = {
    ctx,
    dir: turnsDir(env.home ?? homedir()),
    now: () => env.now?.() ?? new Date(),
    fail: (what, e) => {
      if (env.debug) console.error(`codechart: opencode ${what}: ${e instanceof Error ? e.message : String(e)}`);
    },
    handled: new Set(),
    running: new Set(),
  };
  return { onPrompt: (id: string) => onPrompt(s, id), onIdle: (id: string) => onIdle(s, id), fail: s.fail };
}
