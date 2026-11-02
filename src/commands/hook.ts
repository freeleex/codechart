import { closeSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Argument, Command } from 'commander';
import { findRepoRoot } from '../config/load.js';
import type { CommandOptions } from '../program.js';
import { gitDiffFiles, gitDirtyHashes, gitHead, gitListFiles } from '../rules/git-files.js';

export const MIN_FILES = 3;
const MAX_INPUT = 1024 * 1024;
const MAX_TRANSCRIPT_TAIL = 8 * 1024 * 1024;
const MAX_DIRTY = 5000;
const KEEP_DAYS = 7;
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const DIAGRAM = /\*\*(Map|Flow)\*\*/;

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

type Entry = { type?: string; isMeta?: boolean; message?: { content?: unknown } };
type Block = { type?: string; text?: string; input?: { command?: unknown } };

const blocks = (e: Entry): Block[] => (Array.isArray(e.message?.content) ? (e.message.content as Block[]) : []);

/** A prompt the user typed, not a tool result or an injected note. */
const isPrompt = (e: Entry) =>
  e.type === 'user' && !e.isMeta && (typeof e.message?.content === 'string' || (blocks(e).length > 0 && !blocks(e).some((b) => b.type === 'tool_result')));

/** Whether the agent, since the last prompt, showed a diagram or ran codechart (which may have said no diagram applies). */
export function turnUsedCodechart(jsonl: string): boolean {
  let used = false;
  for (const line of jsonl.split('\n')) {
    let e: Entry;
    try {
      e = JSON.parse(line) as Entry;
    } catch {
      continue;
    }
    if (isPrompt(e)) used = false;
    else if (e.type === 'assistant') {
      for (const b of blocks(e)) {
        if (b.type === 'text' && DIAGRAM.test(b.text ?? '')) used = true;
        if (b.type === 'tool_use' && typeof b.input?.command === 'string' && /\bcodechart\s+(check|render)\b/.test(b.input.command)) used = true;
      }
    }
  }
  return used;
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
  if (text.length > MAX_INPUT) return {};
  const v: unknown = JSON.parse(text);
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

async function readStdin(): Promise<string> {
  let text = '';
  for await (const chunk of process.stdin) {
    text += String(chunk);
    if (text.length > MAX_INPUT) break;
  }
  return text;
}

function snapshot(root: string): Snapshot | undefined {
  const files = gitDirtyHashes(root, MAX_DIRTY);
  return files && { head: gitHead(root), files };
}

function prune(dir: string, now: number) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (now - statSync(p).mtimeMs > KEEP_DAYS * 86_400_000) unlinkSync(p);
  }
}

// No file names: a crafted name would become part of the instruction.
export const nudge = (count: number): string =>
  `This turn changed ${count} files and your reply has no codechart diagram. Unless the user said no diagram, follow the codechart skill now (check, then render) and reply with what it prints; if it says no diagram applies, stop without mentioning it.`;

export function hookCommand(opts: CommandOptions): Command {
  return new Command('hook')
    .description('Claude Code hook (install with install-skill --hook): asks for a diagram after a turn that changed 3+ files without one')
    .addArgument(new Argument('<event>').choices(['prompt', 'stop']))
    .action(async (event: 'prompt' | 'stop') => {
      try {
        const input = await readInput(opts.stdin ?? readStdin);
        const id = input.session_id;
        const cwd = input.cwd;
        if (typeof id !== 'string' || !SESSION_ID.test(id) || typeof cwd !== 'string') return;
        const root = findRepoRoot(cwd);
        if (!root) return;
        const dir = join(opts.home ?? homedir(), '.cache', 'codechart', 'turns');
        const file = join(dir, `${id}.json`);

        if (event === 'prompt') {
          const snap = snapshot(root);
          mkdirSync(dir, { recursive: true, mode: 0o700 });
          prune(dir, (opts.now?.() ?? new Date()).getTime());
          if (snap) writeFileSync(file, JSON.stringify({ root, ...snap }), { mode: 0o600 });
          else unlinkSync(file);
          return;
        }

        if (input.stop_hook_active === true) return;
        const before = JSON.parse(readFileSync(file, 'utf8')) as Snapshot & { root?: string };
        if (before.root !== root) return;
        const now = snapshot(root);
        if (!now) return;
        const files = changedFiles(before, now, (a, b) => (a ? gitDiffFiles(root, a, b) : gitListFiles(root, b)));
        if (files.length < MIN_FILES) return;
        const last = input.last_assistant_message;
        if (typeof last === 'string' && DIAGRAM.test(last)) return;
        // The transcript may lag the final reply (hence last_assistant_message), but holds the turn's earlier tool calls.
        const transcript = input.transcript_path;
        if (typeof transcript === 'string' && turnUsedCodechart(readTail(transcript, MAX_TRANSCRIPT_TAIL))) return;
        opts.stdout(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: nudge(files.length) } })}\n`);
      } catch {
        // A failing hook must never get in the way of the session.
      }
    });
}
