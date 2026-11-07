// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.
import { load, save } from './store.js';
import { isObj, isStr, NOTE_KINDS, targetKey, validTarget, type NoteKind, type NoteTarget } from './targets.js';

export interface Note {
  id: string;
  t: NoteTarget;
  /** The diff hash of the node when the note was made. */
  r?: string;
  k: NoteKind;
  b: string;
  at: string;
  sent?: true;
}

export interface Change {
  slug: string;
  branch: string;
  at: string;
}

/** The note box being filled in. */
export interface Edit {
  t: NoteTarget;
  /** The note being edited; none for a new one. */
  id?: string;
  k: NoteKind;
  text: string;
  /** Not focused yet. */
  fresh: boolean;
}

export interface NoteStore {
  key: string;
  notes: Note[];
  edit: Edit | null;
  /** The arrow or title whose notes are open in a floating box. */
  floating: NoteTarget | null;
  listeners: (() => void)[];
}

export const MAX_NOTES = 500;
export const MAX_BODY = 4000;

function noteOf(v: unknown): Note | null {
  if (!isObj(v)) return null;
  const t = validTarget(v.t);
  const kind = NOTE_KINDS.find((k) => k === v.k);
  if (!t || !isStr(v.id) || !kind || typeof v.b !== 'string' || !v.b.trim() || v.b.length > MAX_BODY || !isStr(v.at) || (v.r !== undefined && typeof v.r !== 'string')) return null;
  return { id: v.id, t, ...(v.r !== undefined && { r: v.r }), k: kind, b: v.b, at: v.at, ...(v.sent === true && { sent: true as const }) };
}

/** What the page saved, with anything malformed dropped. */
export function savedNotes(key: string): Note[] {
  try {
    const v = JSON.parse(load(key) ?? '[]') as unknown;
    const seen = new Set<string>();
    const notes = (Array.isArray(v) ? v : []).map(noteOf).filter((n): n is Note => n !== null && !seen.has(n.id) && !!seen.add(n.id));
    return notes.slice(0, MAX_NOTES);
  } catch {
    return [];
  }
}

export const persistNotes = (s: NoteStore): void => save(s.key, JSON.stringify(s.notes));

export const notesOn = (s: NoteStore, t: NoteTarget): Note[] => s.notes.filter((n) => targetKey(n.t) === targetKey(t));

/** A new note is being written on `t`. */
export const noteAdding = (s: NoteStore, t: NoteTarget): boolean => s.edit !== null && s.edit.id === undefined && targetKey(s.edit.t) === targetKey(t);
