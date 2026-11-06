// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.
import { load, save } from './store.js';

export interface Review {
  /** Shows the ticks again, e.g. after the panel was filled. */
  paint(): void;
  /** Selects the next (or, with `-1`, previous) node not ticked, wrapping; no-op when all are. */
  step(dir: 1 | -1): void;
  /** Ticks or unticks the selected node. */
  toggleSelected(): void;
}

/** Ticked node id -> the diff hash it was ticked at ('' for a node without a diff). */
function savedTicks(key: string): Map<string, string> {
  try {
    const v = JSON.parse(load(key) ?? '[]') as unknown;
    const pairs = Array.isArray(v) ? v.filter((p): p is [string, string] => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string') : [];
    return new Map(pairs);
  } catch {
    return new Map();
  }
}

/**
 * One tick per node id, shared by both panes, kept per repo and only while the node's diff hash is the one it was ticked at.
 * `goTo` selects a node and pans to it.
 */
export function initReview(repo: string, goTo: (id: string) => void): Review {
  const key = `codechart.reviewed:${repo}`;
  const revs = new Map<string, string>();
  document.querySelectorAll('.node').forEach((g) => revs.set(g.getAttribute('data-id')!, g.getAttribute('data-rev') ?? ''));
  const ids = [...revs.keys()];
  const saved = savedTicks(key);
  const done = new Set(ids.filter((id) => saved.get(id) === revs.get(id)));
  const count = document.getElementById('review-count');
  const bar = document.querySelector<HTMLElement>('#review-bar i');
  const next = document.getElementById('next-unreviewed') as HTMLButtonElement | null;
  const paint = () => {
    document.querySelectorAll('.node').forEach((g) => g.classList.toggle('reviewed', done.has(g.getAttribute('data-id')!)));
    document.querySelectorAll<HTMLInputElement>('#panel input[data-tick-for]').forEach((i) => {
      i.checked = done.has(i.getAttribute('data-tick-for')!);
    });
    if (count) count.textContent = `${done.size}/${ids.length} reviewed`;
    if (bar) bar.style.width = `${(done.size / ids.length) * 100}%`;
    if (next) next.disabled = done.size === ids.length;
  };
  const toggle = (id: string) => {
    if (!done.delete(id)) done.add(id);
    // Re-read so ticks saved meanwhile (another tab, another page, an older diff) stay; only this node's entry changes.
    const all = savedTicks(key);
    if (done.has(id)) all.set(id, revs.get(id)!);
    else all.delete(id);
    save(key, JSON.stringify([...all]));
    paint();
  };
  document.querySelectorAll('.tick').forEach((t) => {
    const id = t.closest('.node')!.getAttribute('data-id')!;
    // The tick is part of the node: neither a pan nor a selection may start from it.
    t.addEventListener('pointerdown', (e) => e.stopPropagation());
    t.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle(id);
    });
  });
  document.getElementById('panel')!.addEventListener('change', (e) => {
    const id = (e.target as Element).getAttribute('data-tick-for');
    if (id !== null) toggle(id);
  });
  const step = (dir: 1 | -1) => {
    const at = ids.indexOf(document.querySelector('.node.selected')?.getAttribute('data-id') ?? '');
    const from = at < 0 && dir < 0 ? ids.length : at;
    const to = ids.map((_, i) => ids[(((from + dir * (1 + i)) % ids.length) + ids.length) % ids.length]!).find((id) => !done.has(id));
    if (to !== undefined) goTo(to);
  };
  if (next) next.addEventListener('click', () => step(1));
  const toggleSelected = () => {
    const id = document.querySelector('.node.selected')?.getAttribute('data-id');
    if (id) toggle(id);
  };
  paint();
  return { paint, step, toggleSelected };
}
