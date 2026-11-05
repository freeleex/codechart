// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.

/** What the panel shows: a node or step id, or null for the page info. */
export type Visit = string | null;

export interface Trail {
  /** Shows `v` as a new visit and drops anything ahead of it, like a browser. */
  go(v: Visit): void;
  /** False when there is nothing to go back to. */
  back(): boolean;
  forward(): boolean;
}

interface Entry {
  cc: number;
  v: Visit;
}

const entryOf = (s: unknown): Entry | null =>
  typeof s === 'object' && s !== null && typeof (s as Entry).cc === 'number' ? (s as Entry) : null;

const hashOf = (v: Visit) => (v === null ? '#info' : `#node=${encodeURIComponent(v)}`);

/** The visit a URL names, or undefined when it names none. */
export function visitFromHash(hash: string): Visit | undefined {
  if (hash === '#info') return null;
  if (!hash.startsWith('#node=')) return undefined;
  try {
    return decodeURIComponent(hash.slice(6));
  } catch {
    return undefined;
  }
}

// Sandboxed frames may refuse history changes; the trail then lives only in this page.
function write(push: boolean, e: Entry): boolean {
  try {
    if (push) history.pushState(e, '', hashOf(e.v));
    else history.replaceState(e, '', hashOf(e.v));
    return true;
  } catch {
    return false;
  }
}

function savedEntry(): Entry | null {
  try {
    return entryOf(history.state);
  } catch {
    return null;
  }
}

// How far ahead the trail goes, per tab, so Forward survives a reload without rewriting entries after Back.
const TOP_KEY = () => `codechart.trail:${location.pathname}`;

function loadTop(): number {
  try {
    return Number(sessionStorage.getItem(TOP_KEY())) || 0;
  } catch {
    return 0;
  }
}

function saveTop(top: number): void {
  try {
    sessionStorage.setItem(TOP_KEY(), String(top));
  } catch {
    // Forward forgets the visits ahead after a reload
  }
}

/**
 * `asked`: the visit the URL names, if the page has it. The browser's Back and Forward walk the same trail as the
 * panel's buttons; `open` gets `travelled` true when they brought the visit back rather than a new click.
 */
export function startTrail(asked: () => Visit | undefined, open: (v: Visit, travelled: boolean) => void, moved: (back: boolean, forward: boolean) => void): Trail {
  const saved = savedEntry();
  const first = asked() ?? null;
  // After a reload the visits around this one are still in the browser's history.
  let at = saved ? saved.cc : 0;
  const visits: Visit[] = new Array<Visit>(Math.max(at, saved ? loadTop() : 0) + 1).fill(null);
  visits[at] = first;
  let browser = saved !== null || write(false, { cc: at, v: first });
  const report = () => moved(at > 0, at < visits.length - 1);
  const add = (v: Visit, push: boolean) => {
    at += 1;
    visits.length = at;
    visits.push(v);
    if (browser) browser = write(push, { cc: at, v });
    saveTop(at);
    report();
  };
  const step = (to: number) => {
    at = to;
    open(visits[at]!, true);
    report();
  };
  window.addEventListener('popstate', (e) => {
    const s = entryOf(e.state);
    if (s) {
      visits[s.cc] = s.v;
      step(s.cc);
      return;
    }
    // A #node= link followed in this tab: the browser already made the entry.
    const v = asked();
    if (v === undefined) return;
    add(v, false);
    open(v, true);
  });
  if (!saved) saveTop(0);
  report();
  open(first, true);
  return {
    go(v) {
      if (v === visits[at]) return;
      add(v, true);
      open(v, false);
    },
    back() {
      if (at === 0) return false;
      if (browser) history.back();
      else step(at - 1);
      return true;
    },
    forward() {
      if (at === visits.length - 1) return false;
      if (browser) history.forward();
      else step(at + 1);
      return true;
    },
  };
}
