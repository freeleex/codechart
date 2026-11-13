import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Argument, Command } from 'commander';
import { findRepoRoot } from '../config/load.js';
import type { CommandOptions } from '../program.js';
import { judgeTurn, nudge, saveSnapshot, SESSION_ID, type Outcome } from './hook-core.js';
import { recordPrompt, recordStop, turnsDir } from './hook-record.js';
import { readStdin } from './stdin.js';
import { scanTurn, type TurnScan } from './transcript.js';

const MAX_INPUT = 1024 * 1024;
const MAX_TRANSCRIPT_TAIL = 8 * 1024 * 1024;

function readTail(file: string, max: number): string {
  // O_NONBLOCK: opening a FIFO with no writer would otherwise block the hook forever.
  const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return '';
    const size = Math.min(st.size, max);
    const buf = Buffer.alloc(size);
    readSync(fd, buf, 0, size, st.size - size);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

async function readInput(stdin: () => Promise<string>): Promise<Record<string, unknown>> {
  const text = await stdin();
  if (Buffer.byteLength(text) > MAX_INPUT) return {};
  const v: unknown = JSON.parse(text);
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

interface Turn {
  root: string;
  /** Where this session's snapshot lives. */
  dir: string;
  file: string;
  input: Record<string, unknown>;
  /** The transcript tail read once, only when something asks. */
  scan: () => TurnScan | undefined;
}

interface Verdict extends Outcome {
  reminder?: string;
}

/** What the Stop hook decides, with the reminder to print when it asks for a diagram. */
function onStop({ root, file, input, scan }: Turn): Verdict {
  if (input.stop_hook_active === true) return { decision: 'stop_hook_active' };
  const last = input.last_assistant_message;
  // The transcript may lag the final reply (hence last_assistant_message), but holds the turn's earlier tool calls.
  const outcome = judgeTurn(root, file, typeof last === 'string' ? last : undefined, scan);
  if (outcome.decision !== 'nudged') return outcome;
  const reminder = `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: nudge(outcome.files?.length ?? 0) } })}\n`;
  return { ...outcome, reminder };
}

function record(turn: Turn, now: Date, outcome?: Outcome): void {
  const at = now.toISOString();
  const session = String(turn.input.session_id);
  try {
    if (!outcome) return recordPrompt(turn.dir, turn.root, session, at);
    let seen: TurnScan | undefined;
    // A turn that changed nothing skips the transcript read.
    if (outcome.files?.length) {
      try {
        seen = turn.scan();
      } catch {
        seen = undefined;
      }
    }
    recordStop(turn.dir, { at, root: turn.root, session, decision: outcome.decision, files: outcome.files, skill: seen?.skill, cli: seen?.cli });
  } catch {
    // The log is for doctor --last; it must never get in the way of the hook.
  }
}

async function runHook(event: 'prompt' | 'stop', opts: CommandOptions): Promise<void> {
  const input = await readInput(opts.stdin ?? (() => readStdin(MAX_INPUT, 'stop')));
  const id = input.session_id;
  const cwd = input.cwd;
  if (typeof id !== 'string' || !SESSION_ID.test(id) || typeof cwd !== 'string') return;
  const root = findRepoRoot(cwd);
  if (!root) return;
  const dir = turnsDir(opts.home ?? homedir());
  const path = input.transcript_path;
  let scanned: TurnScan | undefined;
  const scan = () => (scanned ??= typeof path === 'string' ? scanTurn(readTail(path, MAX_TRANSCRIPT_TAIL)) : undefined);
  const turn = { root, dir, file: join(dir, `${id}.json`), input, scan };
  const now = opts.now?.() ?? new Date();
  if (event === 'prompt') {
    try {
      saveSnapshot(dir, turn.file, root, now);
    } finally {
      record(turn, now);
    }
    return;
  }
  const outcome = onStop(turn);
  record(turn, now, outcome);
  if (outcome.reminder) opts.stdout(outcome.reminder);
}

export function hookCommand(opts: CommandOptions): Command {
  return new Command('hook')
    .description('Claude Code hook (install with install-skill --hook): asks for a diagram after a turn that changed 3+ files without one')
    .addArgument(new Argument('<event>').choices(['prompt', 'stop']))
    .action(async (event: 'prompt' | 'stop') => {
      try {
        await runHook(event, opts);
      } catch (e) {
        // A failing hook must never get in the way of the session; only CODECHART_DEBUG says why.
        if ((opts.env ?? process.env).CODECHART_DEBUG) opts.stderr(`codechart: hook ${event}: ${e instanceof Error ? e.message : String(e)}\n`);
      }
    });
}
