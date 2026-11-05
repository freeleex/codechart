import { lstatSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitDiffFiles, gitDirtyHashes, gitHead, gitListFiles } from '../rules/git-files.js';
import type { Decision } from './hook-record.js';
import { DIAGRAM } from './transcript.js';

export const MIN_FILES = 3;
const MAX_DIRTY = 5000;
const KEEP_DAYS = 7;
export const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

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
export const nudge = (count: number): string =>
  `This turn changed ${count} files and your reply has no codechart diagram. Unless the user said no diagram, follow the codechart skill now (check, then render) and reply with what it prints; if it says no diagram applies, stop without mentioning it.`;

export interface Outcome {
  decision: Decision;
  files?: string[];
}

/** What the agent showed or ran since the user's prompt. */
export interface Used {
  diagram: boolean;
  cli: boolean;
}

/** Records the files dirty now as the turn's starting point, in `file` under `dir`. */
export function saveSnapshot(dir: string, file: string, root: string, now: Date): void {
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

/** Whether the turn since the snapshot in `file` earns a nudge. `reply`: the agent's last message; `used`: read only when that is not enough. */
export function judgeTurn(root: string, file: string, reply: string | undefined, used: () => Used | undefined): Outcome {
  const before = readSnapshot(file);
  if (!before) return { decision: 'no-snapshot' };
  if (before.root !== root) return { decision: 'other-root' };
  const now = snapshot(root);
  if (!now) return { decision: 'no-snapshot' };
  const files = changedFiles(before, now, (a, b) => (a ? gitDiffFiles(root, a, b) : gitListFiles(root, b)));
  if (files.length < MIN_FILES) return { decision: 'few-files', files };
  if (reply !== undefined && DIAGRAM.test(reply)) return { decision: 'diagram-in-reply', files };
  const seen = used();
  if (seen && (seen.diagram || seen.cli)) return { decision: 'codechart-used', files };
  return { decision: 'nudged', files };
}
