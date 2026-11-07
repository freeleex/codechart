// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.
import { MAX_BODY, type Edit, type Note } from './note-store.js';
import { KIND_LABEL, NOTE_KINDS, type NoteTarget } from './targets.js';

export function cmEl<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function cmButton(cls: string, text: string, label: string, on: () => void): HTMLButtonElement {
  const b = cmEl('button', cls, text);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.addEventListener('click', on);
  return b;
}

/** An SVG element, in the namespace the page's own drawing uses. */
const cmSvg = (tag: string, attrs: Record<string, string>, text?: string): Element => {
  const e = document.createElementNS(document.querySelector('svg')!.namespaceURI, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
};

function noteBox(e: Edit, onSave: () => void, onCancel: () => void): HTMLTextAreaElement {
  const ta = cmEl('textarea', '');
  ta.rows = 3;
  ta.maxLength = MAX_BODY;
  ta.value = e.text;
  ta.setAttribute('aria-label', 'Note');
  ta.addEventListener('input', () => {
    e.text = ta.value;
  });
  ta.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      onCancel();
    } else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      onSave();
    }
  });
  return ta;
}

/** The small form: text, kind (Comment / Question / Delete), Save and Cancel. */
export function composerEl(e: Edit, onSave: () => void, onCancel: () => void): HTMLElement {
  const box = cmEl('div', `cm-composer cm-k-${e.k}`);
  const kinds = cmEl('div', 'cm-kinds');
  kinds.setAttribute('role', 'group');
  kinds.setAttribute('aria-label', 'Kind of note');
  for (const k of NOTE_KINDS) {
    const b = cmButton(`cm-kind-btn cm-k-${k}`, KIND_LABEL[k], KIND_LABEL[k], () => {
      e.k = k;
      box.className = `cm-composer cm-k-${k}`;
      kinds.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });
    b.setAttribute('aria-pressed', String(k === e.k));
    kinds.append(b);
  }
  const actions = cmEl('div', 'cm-actions');
  actions.append(cmButton('cm-cancel', 'Cancel', 'Cancel', onCancel), cmButton('cm-save', 'Save', 'Save note', onSave));
  const row = cmEl('div', 'cm-row');
  row.append(kinds, actions);
  box.append(noteBox(e, onSave, onCancel), row);
  return box;
}

/** A saved note: its kind, its text (as text, never markup) and Edit / Remove. */
export function noteRow(n: Note, onEdit: () => void, onRemove: () => void): HTMLElement {
  const row = cmEl('div', `cm-note cm-k-${n.k}${n.sent ? ' sent' : ''}`);
  if (n.sent) row.title = 'Already copied for the agent. Editing it makes it unsent again.';
  const actions = cmEl('span', 'cm-actions');
  actions.append(cmButton('cm-edit', 'Edit', 'Edit note', onEdit), cmButton('cm-remove', 'Remove', 'Remove note', onRemove));
  row.append(cmEl('b', 'cm-kind', KIND_LABEL[n.k]), cmEl('span', 'cm-body', n.b), actions);
  return row;
}

/** The top-right corner of a node's box, in its own coordinates. */
function nodeCorner(g: SVGGraphicsElement): { x: number; y: number } {
  try {
    const b = g.getBBox();
    return { x: b.x + b.width, y: b.y };
  } catch {
    return { x: 0, y: 0 };
  }
}

/** A count on the node's top-right corner. */
export function nodeBadge(g: SVGGraphicsElement, count: number): void {
  const { x, y } = nodeCorner(g);
  const badge = cmSvg('g', { class: 'cm-m cm-badge', 'aria-hidden': 'true' });
  badge.append(cmSvg('circle', { cx: String(x), cy: String(y), r: '8' }), cmSvg('text', { x: String(x), y: String(y + 3) }, String(count)));
  g.append(badge);
}

/** Where an edge's button sits: after its label, else mid-line. */
function edgeSpot(g: Element): { x: number; y: number } {
  const rect = g.querySelector('rect');
  if (rect) return { x: Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) + 9, y: Number(rect.getAttribute('y')) + 6 };
  const n = (g.querySelector('path')?.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const pairs = Math.floor(n.length / 2);
  const at = (i: number) => ({ x: n[i * 2] ?? 0, y: n[i * 2 + 1] ?? 0 });
  if (pairs % 2 === 1) return at((pairs - 1) / 2);
  const a = at(Math.max(0, pairs / 2 - 1));
  const b = at(pairs / 2);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** A button on an arrow, with a wide invisible stroke so the line is easy to hover. A press on it starts no pan. */
export function edgeMarkers(g: Element, t: NoteTarget, count: number, toggle: () => void): void {
  const { x, y } = edgeSpot(g);
  const hit = cmSvg('path', { class: 'cm-m cm-hit', d: g.querySelector('path')?.getAttribute('d') ?? '' });
  const label = count ? `${count} note${count === 1 ? '' : 's'} on this arrow` : 'Add a note to this arrow';
  const btn = cmSvg('g', { class: `cm-m cm-edge-btn${count ? ' has' : ''}`, role: 'button', tabindex: '0', 'aria-label': label, 'data-cm': JSON.stringify(t) });
  btn.append(cmSvg('circle', { cx: String(x), cy: String(y), r: '8' }), cmSvg('text', { x: String(x), y: String(y + 3.5) }, count ? String(count) : '\u{1F4AC}'));
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });
  btn.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k !== 'Enter' && k !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    toggle();
  });
  g.append(hit, btn);
}
