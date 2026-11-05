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

export function createHandlers(ctx: Context, env: Env = {}) {
  const dir = turnsDir(env.home ?? homedir());
  const now = () => env.now?.() ?? new Date();
  const handled = new Set<string>();
  const running = new Set<string>();
  const fail = (what: string, e: unknown) => {
    if (env.debug) console.error(`codechart: opencode ${what}: ${e instanceof Error ? e.message : String(e)}`);
  };

  async function onPrompt(sessionID: string): Promise<void> {
    if (!SESSION_ID.test(sessionID)) return;
    const root = rootOf(await ctx.session.get({ sessionID }));
    if (!root) return;
    const at = now();
    try {
      saveSnapshot(dir, join(dir, `${sessionID}.json`), root, at);
    } finally {
      try {
        recordPrompt(dir, root, sessionID, at.toISOString(), 'opencode');
      } catch (e) {
        fail('record', e);
      }
    }
  }

  async function check(sessionID: string): Promise<void> {
    if (!SESSION_ID.test(sessionID)) return;
    const session = await ctx.session.get({ sessionID });
    if (session.parentID || !sameLocation(session.location, ctx.location)) return;
    const messages = await ctx.session.context({ sessionID });
    const turn = viewTurn(messages);
    if (!turn || (turn.outcome ?? session.outcome) !== 'succeeded') return;
    if ((session.model?.providerID ?? turn.providerID) === CLAUDE_PROVIDER) return;
    const key = `${sessionID}:${turn.userID}`;
    if (turn.nudged || handled.has(key)) return;
    if (handled.size >= MAX_HANDLED) handled.clear();
    handled.add(key);
    const root = rootOf(session);
    if (!root) return;
    const outcome = judgeTurn(root, join(dir, `${sessionID}.json`), turn.reply, () => turn);
    if (outcome.decision === 'nudged') {
      await ctx.session.synthetic({ sessionID, text: nudge(outcome.files?.length ?? 0), metadata: { codechart: 'nudge' }, resume: true });
    }
    try {
      recordStop(dir, { at: now().toISOString(), root, session: sessionID, decision: outcome.decision, files: outcome.files, cli: turn.cli, agent: 'opencode' });
    } catch (e) {
      fail('record', e);
    }
  }

  async function onIdle(sessionID: string): Promise<void> {
    if (running.has(sessionID)) return;
    running.add(sessionID);
    try {
      await check(sessionID);
    } catch (e) {
      fail('idle', e);
    } finally {
      running.delete(sessionID);
    }
  }

  return { onPrompt, onIdle, fail };
}
