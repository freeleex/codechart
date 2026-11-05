import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Decision = 'stop_hook_active' | 'no-snapshot' | 'other-root' | 'few-files' | 'diagram-in-reply' | 'codechart-used' | 'nudged';

const MAX_FILES = 500;
const SUFFIX = '.turn.json';

/** What a hook did in a session's latest turn; `decision` is missing until the Stop hook has run. */
export interface TurnRecord {
  at: string;
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
      if (r.root === root && typeof r.at === 'string' && (!best || r.at > best.at)) best = r;
    } catch {
      continue;
    }
  }
  return best;
}
