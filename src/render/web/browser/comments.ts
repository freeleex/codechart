// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.
import { modalOpen, typing } from './hunks.js';
import { MAX_NOTES, notesOn, persistNotes, savedNotes, type Change, type Note, type NoteStore } from './note-store.js';
import { noteSelectedId, notePaint } from './note-paint.js';
import { lineTarget, nodeOfTarget, targetKey, type NoteTarget } from './targets.js';

export interface Comments {
  /** Draws the notes and their buttons again, e.g. after the panel was filled. */
  paint(): void;
  unsent(): Note[];
  markSent(ids: string[]): void;
  /** Runs now and after every redraw. */
  onChange(fn: () => void): void;
}

const isFloating = (t: NoteTarget) => 'edge' in t || 'title' in t;

/** Opens the note box on `t`, or on the note `n` made there. */
export function noteBegin(s: NoteStore, t: NoteTarget, n?: Note): void {
  s.edit = { t, id: n?.id, k: n?.k ?? 'comment', text: n?.b ?? '', fresh: true };
  if (isFloating(t)) s.floating = t;
  notePaint(s);
}

export function noteCancel(s: NoteStore): void {
  if (s.edit && s.floating && targetKey(s.edit.t) === targetKey(s.floating) && !notesOn(s, s.floating).length) s.floating = null;
  s.edit = null;
  notePaint(s);
}

/** Saves the box: an empty note is not saved, and editing a sent note makes it unsent. */
export function noteSubmit(s: NoteStore): void {
  const e = s.edit!;
  const body = e.text.trim();
  if (!body) return notePaint(s);
  const old = s.notes.find((n) => n.id === e.id);
  if (old) {
    old.b = body;
    old.k = e.k;
    delete old.sent;
  } else if (s.notes.length < MAX_NOTES) {
    const id = nodeOfTarget(e.t);
    const rev = id === undefined ? null : [...document.querySelectorAll('.node')].find((g) => g.getAttribute('data-id') === id)?.getAttribute('data-rev');
    s.notes.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), t: e.t, ...(rev && { r: rev }), k: e.k, b: body, at: new Date().toISOString() });
  }
  if (s.floating && targetKey(s.floating) === targetKey(e.t)) s.floating = null;
  s.edit = null;
  persistNotes(s);
  notePaint(s);
}

/** A floating box closes on a click elsewhere or when the map moves, unless it holds a draft. */
function closeFloating(s: NoteStore): void {
  if (!s.floating || s.edit?.text.trim()) return;
  s.floating = null;
  s.edit = null;
  notePaint(s);
}

export function noteRemove(s: NoteStore, n: Note): void {
  s.notes = s.notes.filter((x) => x !== n);
  if (s.edit?.id === n.id) s.edit = null;
  persistNotes(s);
  notePaint(s);
}

/** An arrow's or the title's box opens and closes on its button. */
export function noteToggleFloating(s: NoteStore, t: NoteTarget): void {
  const open = s.floating !== null && targetKey(s.floating) === targetKey(t);
  s.edit = null;
  s.floating = open ? null : t;
  if (!open && !notesOn(s, t).length) noteBegin(s, t);
  else notePaint(s);
}

/**
 * Notes anywhere on the page: on a node, a diff line, a plan-vs-built note, an arrow, a gap, a not-on-map item or the title.
 * Kept per page (`change`) in localStorage; `repo` tells same-named repos apart.
 */
export function initComments(repo: string, change: Change): Comments {
  const key = `codechart.notes:${repo}:${change.slug}:${change.at}`;
  const s: NoteStore = { key, notes: savedNotes(key), edit: null, floating: null, listeners: [] };
  document.body.classList.add('cm');
  document.getElementById('panel')!.addEventListener('click', (e) => {
    const ln = (e.target as Element).closest('.dr .ln');
    const id = noteSelectedId();
    const t = ln && id !== null ? lineTarget(ln.parentElement!, id) : null;
    if (t) noteBegin(s, t);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!(e.target as Element).closest?.('.cm-float, [data-cm]')) closeFloating(s);
  }, true);
  window.addEventListener('wheel', (e) => {
    if (!(e.target as Element).closest?.('.cm-float')) closeFloating(s);
  }, { capture: true, passive: true });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && s.floating && !s.edit) {
      s.floating = null;
      notePaint(s);
      return;
    }
    if (e.key !== 'c' || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || modalOpen()) return;
    const id = noteSelectedId();
    if (id === null) return;
    e.preventDefault();
    noteBegin(s, { node: id });
  });
  return {
    paint: () => notePaint(s),
    unsent: () => s.notes.filter((n) => !n.sent),
    markSent(ids) {
      for (const n of s.notes) if (ids.includes(n.id)) n.sent = true;
      persistNotes(s);
      notePaint(s);
    },
    onChange: (fn) => {
      s.listeners.push(fn);
      fn();
    },
  };
}
