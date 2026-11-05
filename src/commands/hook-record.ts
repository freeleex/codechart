import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Decision = 'stop_hook_active' | 'no-snapshot' | 'other-root' | 'few-files' | 'diagram-in-reply' | 'codechart-used' | 'nudged';

const MAX_FILES = 500;
const SUFFIX = '.turn.json';

/** What a hook did in a session's last turn that mattered; `decision` is missing until a Stop hook has run. */
export interface TurnRecord {
  at: string;
  /** A later prompt that no Stop has answered yet (it may be the turn running now). */
  pendingAt?: string;
  /** A later turn that changed no files, so it left this record alone. */
  quietAt?: string;
  root: string;
  session: string;
  decision?: Decision;
  files?: string[];
  /** Whether the transcript shows the codechart skill loaded / the CLI run this turn. */
  skill?: boolean;
  cli?: boolean;
}

export const turnsDir = (home: string) => join(home, '.cache', 'codechart', 'turns');

// Session ids never hold a dot, so this name cannot collide with a snapshot.
export function writeRecord(dir: string, record: TurnRecord): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const files = record.files && record.files.slice(0, MAX_FILES);
  writeFileSync(join(dir, `${record.session}${SUFFIX}`), JSON.stringify({ ...record, files }), { mode: 0o600 });
}

const activity = (r: TurnRecord) => [r.at, r.pendingAt, r.quietAt].reduce<string>((m, t) => (t && t > m ? t : m), '');

function readRecord(dir: string, session: string): TurnRecord | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, `${session}${SUFFIX}`), 'utf8')) as TurnRecord;
  } catch {
    return undefined;
  }
}

/** A prompt: the last decided turn stays, so asking "why no diagram?" does not erase what it asks about. */
export function recordPrompt(dir: string, root: string, session: string, at: string): void {
  const prev = readRecord(dir, session);
  writeRecord(dir, prev ? { ...prev, pendingAt: at } : { at, root, session, pendingAt: at });
}

/** A Stop decision; a repeat stop of a decided turn, or a turn that changed nothing, leaves the earlier details. */
export function recordStop(dir: string, rec: TurnRecord): void {
  const prev = readRecord(dir, rec.session);
  if (rec.decision === 'stop_hook_active' && prev?.decision && !prev.pendingAt) return;
  if (rec.decision === 'few-files' && !rec.files?.length && prev?.files?.length) {
    writeRecord(dir, { ...prev, pendingAt: undefined, quietAt: rec.at });
    return;
  }
  writeRecord(dir, rec);
}

/** The newest record for `root`, or undefined. */
export function latestRecord(dir: string, root: string): TurnRecord | undefined {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(SUFFIX));
  } catch {
    return undefined;
  }
  let best: TurnRecord | undefined;
  for (const name of names) {
    try {
      const r = JSON.parse(readFileSync(join(dir, name), 'utf8')) as TurnRecord;
      if (r.root === root && typeof r.at === 'string' && (!best || activity(r) > activity(best))) best = r;
    } catch {
      continue;
    }
  }
  return best;
}
