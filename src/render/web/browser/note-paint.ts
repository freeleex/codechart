// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.
import { noteBegin, noteCancel, noteRemove, noteSubmit, noteToggleFloating } from './comments.js';
import { composerEl, cmButton, cmEl, edgeMarkers, nodeBadge, noteRow } from './note-view.js';
import { noteAdding, notesOn, type NoteStore } from './note-store.js';
import { edgeTarget, lineTarget, nodeOfTarget, targetKey, type NoteTarget } from './targets.js';

export const noteSelectedId = (): string | null => document.querySelector('.node.selected')?.getAttribute('data-id') ?? null;

/** The notes made on `t` and, if one is being written, its box; null when there is neither. */
function thread(s: NoteStore, t: NoteTarget, float = false): HTMLElement | null {
  const list = notesOn(s, t);
  if (!list.length && !noteAdding(s, t)) return null;
  const form = () => composerEl(s.edit!, () => noteSubmit(s), () => noteCancel(s));
  const box = cmEl('div', `cm-m cm-thread${float ? ' cm-float' : ''}`);
  for (const n of list) box.append(s.edit?.id === n.id ? form() : noteRow(n, () => noteBegin(s, n.t, n), () => noteRemove(s, n)));
  if (noteAdding(s, t)) box.append(form());
  else if (float) box.append(cmButton('cm-more', '+ Add another note', 'Add another note', () => noteBegin(s, t)));
  return box;
}

function addButton(s: NoteStore, t: NoteTarget, run: () => void, cls = ''): HTMLButtonElement {
  const n = notesOn(s, t).length;
  const b = cmButton(`cm-m cm-btn${cls}`, n ? `\u{1F4AC} ${n}` : '\u{1F4AC}', n ? `${n} note${n === 1 ? '' : 's'}, add another` : 'Add a note', run);
  b.title = 'Add a note';
  b.setAttribute('data-cm', JSON.stringify(t));
  return b;
}

function paintNodes(s: NoteStore): void {
  const counts = new Map<string, number>();
  for (const n of s.notes) {
    const id = nodeOfTarget(n.t);
    if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  document.querySelectorAll<SVGGraphicsElement>('.node').forEach((g) => {
    const count = counts.get(g.getAttribute('data-id')!);
    if (count) nodeBadge(g, count);
  });
}

function paintEdges(s: NoteStore): void {
  document.querySelectorAll('.edge[data-from]').forEach((g) => {
    const t = edgeTarget(g);
    edgeMarkers(g, t, notesOn(s, t).length, () => noteToggleFloating(s, t));
  });
}

function paintTitle(s: NoteStore): void {
  const t: NoteTarget = { title: true };
  document.querySelector('header h1')?.after(addButton(s, t, () => noteToggleFloating(s, t), ' cm-title-btn'));
}

/** The gaps and not-on-map items, each with its button and notes. */
function paintInfo(s: NoteStore): void {
  document.querySelectorAll('#page-info ul[data-notes]').forEach((ul) => {
    const kind = ul.getAttribute('data-notes');
    for (const li of ul.children) {
      const t: NoteTarget = kind === 'gap' ? { gap: li.textContent! } : { omitted: li.textContent! };
      li.append(addButton(s, t, () => noteBegin(s, t)));
      const th = thread(s, t);
      if (th) li.append(th);
    }
  });
}

function paintDrift(s: NoteStore, panel: Element, id: string): void {
  const drift = panel.querySelector('.drift[data-drift-id]');
  const kind = drift?.getAttribute('data-drift-kind');
  if (!drift || (kind !== 'missing' && kind !== 'unplanned' && kind !== 'different')) return;
  const t: NoteTarget = { drift: id, kind };
  drift.append(addButton(s, t, () => noteBegin(s, t), ' cm-drift-btn'));
  const th = thread(s, t);
  if (th) drift.after(th);
}

function paintPanel(s: NoteStore, id: string): void {
  const panel = document.getElementById('panel')!;
  const head = panel.querySelector('.phead');
  if (!head) return;
  const t: NoteTarget = { node: id };
  head.querySelector('.ptitle')?.append(addButton(s, t, () => noteBegin(s, t), ' cm-node-btn'));
  const th = thread(s, t);
  if (th) head.after(th);
  paintDrift(s, panel, id);
  if (!s.notes.some((n) => 'path' in n.t) && !(s.edit && 'path' in s.edit.t)) return;
  panel.querySelectorAll('.dr').forEach((row) => {
    const lt = lineTarget(row, id);
    const lth = lt && thread(s, lt);
    if (lth) row.after(lth);
  });
}

function paintFloating(s: NoteStore): void {
  if (!s.floating) return;
  const th = thread(s, s.floating, true);
  if (!th) {
    s.floating = null;
    return;
  }
  const k = targetKey(s.floating);
  const r = [...document.querySelectorAll('[data-cm]')].find((a) => a.getAttribute('data-cm') === k)?.getBoundingClientRect();
  th.style.top = `${Math.min((r?.bottom ?? 40) + 6, window.innerHeight - 60)}px`;
  th.style.left = `${Math.max(8, Math.min(r?.left ?? 8, window.innerWidth - 340))}px`;
  document.body.append(th);
}

/** Draws every note and button again; what a click changes is redrawn from the state. */
export function notePaint(s: NoteStore): void {
  document.querySelectorAll('.cm-m').forEach((e) => e.remove());
  paintTitle(s);
  paintNodes(s);
  paintEdges(s);
  paintInfo(s);
  const id = noteSelectedId();
  if (id !== null) paintPanel(s, id);
  paintFloating(s);
  // The place it was written at is gone (another node opened): the draft goes with it.
  if (s.edit && !document.querySelector('.cm-composer')) s.edit = null;
  if (s.edit?.fresh) {
    s.edit.fresh = false;
    document.querySelector<HTMLTextAreaElement>('.cm-composer textarea')?.focus();
  }
  s.listeners.forEach((f) => f());
}
