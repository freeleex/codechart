import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Argument, Command } from 'commander';
import { findRepoRoot } from '../config/load.js';
import type { CommandOptions } from '../program.js';
import { gitDiffFiles, gitDirtyHashes, gitHead, gitListFiles } from '../rules/git-files.js';
import { type Decision, turnsDir, writeRecord } from './hook-record.js';
import { readStdin } from './stdin.js';
import { DIAGRAM, scanTurn, type TurnScan } from './transcript.js';

const MIN_FILES = 3;
const MAX_INPUT = 1024 * 1024;
const MAX_TRANSCRIPT_TAIL = 8 * 1024 * 1024;
const MAX_DIRTY = 5000;
const KEEP_DAYS = 7;
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface Snapshot {
  head?: string;
  files: Record<string, string>;
}

/** Files whose content changed between two snapshots, plus those changed by commits made in between (`from` undefined: the repo's first commit). */
export function changedFiles(before: Snapshot, now: Snapshot, diff: (from: string | undefined, to: string) => string[]): string[] {
  const changed = new Set<string>();
  for (const f of new Set([...Object.keys(before.files), ...Object.keys(now.files)])) {
    if (before.files[f] !== now.files[f]) changed.add(f);
  }
  if (now.head && before.head !== now.head) for (const f of diff(before.head, now.head)) changed.add(f);
  return [...changed].sort();
}

function readTail(file: string, max: number): string {
  const fd = openSync(file, 'r');
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

function snapshot(root: string): Snapshot | undefined {
  const files = gitDirtyHashes(root, MAX_DIRTY);
  return files && { head: gitHead(root), files };
}

function prune(dir: string, now: number) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = lstatSync(p);
    if (st.isFile() && now - st.mtimeMs > KEEP_DAYS * 86_400_000) unlinkSync(p);
  }
}

// No file names: a crafted name would become part of the instruction.
const nudge = (count: number): string =>
  `This turn changed ${count} files and your reply has no codechart diagram. Unless the user said no diagram, follow the codechart skill now (check, then render) and reply with what it prints; if it says no diagram applies, stop without mentioning it.`;

interface Turn {
  root: string;
  /** Where this session's snapshot lives. */
  dir: string;
  file: string;
  input: Record<string, unknown>;
  /** The transcript tail read once, only when something asks. */
  scan: () => TurnScan | undefined;
}

interface Outcome {
  decision: Decision;
  files?: string[];
  reminder?: string;
}

function onPrompt({ root, dir, file }: Turn, now: Date): void {
  const snap = snapshot(root);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  prune(dir, now.getTime());
  if (snap) writeFileSync(file, JSON.stringify({ root, ...snap }), { mode: 0o600 });
  else unlinkSync(file);
}

function readSnapshot(file: string): (Snapshot & { root?: string }) | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Snapshot & { root?: string };
  } catch {
    return undefined;
  }
}

/** What the Stop hook decides, with the reminder to print when it asks for a diagram. */
function onStop({ root, file, input, scan }: Turn): Outcome {
  if (input.stop_hook_active === true) return { decision: 'stop_hook_active' };
  const before = readSnapshot(file);
  if (!before) return { decision: 'no-snapshot' };
  if (before.root !== root) return { decision: 'other-root' };
  const now = snapshot(root);
  if (!now) return { decision: 'no-snapshot' };
  const files = changedFiles(before, now, (a, b) => (a ? gitDiffFiles(root, a, b) : gitListFiles(root, b)));
  if (files.length < MIN_FILES) return { decision: 'few-files', files };
  const last = input.last_assistant_message;
  if (typeof last === 'string' && DIAGRAM.test(last)) return { decision: 'diagram-in-reply', files };
  // The transcript may lag the final reply (hence last_assistant_message), but holds the turn's earlier tool calls.
  const used = scan();
  if (used && (used.diagram || used.cli)) return { decision: 'codechart-used', files };
  const reminder = `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: nudge(files.length) } })}\n`;
  return { decision: 'nudged', files, reminder };
}

function record(turn: Turn, now: Date, outcome?: Outcome): void {
  try {
    let seen: TurnScan | undefined;
    // A turn that changed nothing skips the transcript read.
    if (outcome?.files?.length) {
      try {
        seen = turn.scan();
      } catch {
        seen = undefined;
      }
    }
    writeRecord(turn.dir, {
      at: now.toISOString(),
      root: turn.root,
      session: String(turn.input.session_id),
      ...(outcome && { decision: outcome.decision, files: outcome.files, skill: seen?.skill, cli: seen?.cli }),
    });
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
      onPrompt(turn, now);
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
