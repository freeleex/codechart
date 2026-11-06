// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.
import type { Review } from './review.js';

export interface Hunks {
  /** A new panel was filled: no current hunk, scrolled to the top. */
  reset(): void;
}

/** A checkbox keeps focus after a click, and keys must still work then. */
const typing = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === 'INPUT') return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes((el as HTMLInputElement).type);
  return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
};

const isOpen = (h: HTMLElement) => !h.classList.contains('folded');

function setOpen(h: HTMLElement, open: boolean): void {
  h.classList.toggle('folded', !open);
  h.querySelector('.hunk-sum')?.setAttribute('aria-expanded', String(open));
}

const hunksIn = (panel: HTMLElement) => [...panel.querySelectorAll<HTMLElement>('.hunk')];

function paintCount(panel: HTMLElement, cur: HTMLElement | null): void {
  const label = panel.querySelector('.pg-count');
  if (!label) return;
  const hunks = hunksIn(panel);
  const at = cur ? hunks.indexOf(cur) + 1 : 0;
  label.textContent = `${at || '\u2013'} / ${hunks.length}`;
  label.setAttribute('aria-label', at ? `hunk ${at} of ${hunks.length}` : `${hunks.length} hunks`);
}

function endNote(panel: HTMLElement): HTMLElement {
  const note = document.createElement('p');
  note.className = 'hunk-end';
  note.textContent = 'end of node · ] next unreviewed';
  const last = hunksIn(panel).at(-1)?.closest('.file');
  if (last) last.after(note);
  else panel.appendChild(note);
  return note;
}

interface Nav {
  step(dir: 1 | -1): void;
  /** Folds or opens the current (else first) hunk. */
  toggle(): void;
  /** Folds all hunks, or opens them all when any is folded. */
  toggleAll(): void;
  /** Opens or folds every hunk. */
  setAll(open: boolean): void;
  /** A click on a hunk's summary line. */
  pick(h: HTMLElement): void;
  reset(): void;
}

/** The current hunk of the open panel (the one with the blue bar) and the "end of node" note after the last. */
function walker(panel: HTMLElement, aside: Element): Nav {
  let cur: HTMLElement | null = null;
  let end: HTMLElement | null = null;
  const paint = () => paintCount(panel, cur);
  const mark = (h: HTMLElement | null) => {
    cur?.classList.remove('cur');
    cur = h;
    h?.classList.add('cur');
    paint();
  };
  const hideEnd = () => {
    end?.remove();
    end = null;
  };
  const show = (h: HTMLElement) => {
    hideEnd();
    mark(h);
    hunksIn(panel).forEach((x) => setOpen(x, x === h));
  };
  const showEnd = () => {
    end ??= endNote(panel);
  };
  const setAll = (open: boolean) => hunksIn(panel).forEach((h) => setOpen(h, open));
  return {
    step(dir) {
      if (end && dir < 0) {
        if (cur) show(cur);
        return;
      }
      const hunks = hunksIn(panel);
      const i = cur ? hunks.indexOf(cur) : -1;
      const to = hunks[dir > 0 ? i + 1 : Math.max(0, i - 1)];
      if (to) show(to);
      else if (dir > 0) showEnd();
    },
    toggle() {
      const h = cur ?? hunksIn(panel)[0];
      if (h) setOpen(h, !isOpen(h));
    },
    toggleAll() {
      setAll(!hunksIn(panel).every(isOpen));
    },
    setAll,
    pick(h) {
      setOpen(h, !isOpen(h));
      mark(h);
      hideEnd();
    },
    reset() {
      cur = null;
      end = null;
      aside.scrollTop = 0;
      paint();
    },
  };
}

/** Folding hunks and opening runs of unchanged lines by click, and the keys: n/p hunks, ]/[ unreviewed nodes, r reviewed, f zoom to the node, o/O fold, ? help. */
export function initHunks(panel: HTMLElement, review: Review, zoomToNode: () => void): Hunks {
  const nav = walker(panel, panel.closest('aside')!);
  const help = document.getElementById('key-help')!;
  const toggleHelp = () => {
    help.hidden = !help.hidden;
  };
  const keys: Record<string, () => void> = {
    n: () => nav.step(1),
    p: () => nav.step(-1),
    ']': () => review.step(1),
    '[': () => review.step(-1),
    r: () => review.toggleSelected(),
    f: zoomToNode,
    o: () => nav.toggle(),
    O: () => nav.toggleAll(),
    '?': toggleHelp,
  };
  const buttons: Record<string, () => void> = {
    '.pg-prev': () => nav.step(-1),
    '.pg-next': () => nav.step(1),
    '.pg-expand': () => nav.setAll(true),
    '.pg-collapse': () => nav.setAll(false),
    '.pg-keys': toggleHelp,
  };
  panel.addEventListener('click', (e) => {
    const t = e.target as Element;
    const h = t.closest('.hunk-sum')?.closest<HTMLElement>('.hunk');
    if (h) nav.pick(h);
    const gap = t.closest('.gap-run');
    if (gap) gap.setAttribute('aria-expanded', String(gap.parentElement!.classList.toggle('open')));
    for (const [sel, run] of Object.entries(buttons)) if (t.closest(sel)) run();
  });
  help.addEventListener('click', () => {
    help.hidden = true;
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') help.hidden = true;
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    const run = Object.hasOwn(keys, e.key) ? keys[e.key] : undefined;
    if (!run) return;
    e.preventDefault();
    run();
  });
  return { reset: nav.reset };
}
