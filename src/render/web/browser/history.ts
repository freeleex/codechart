// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.

/** What the panel shows: a node or step id, or null for the page info. */
export type Visit = string | null;

export interface Trail {
  /** Shows `v` as a new visit and drops anything ahead of it, like a browser. */
  go(v: Visit): void;
  back(): void;
  forward(): void;
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

/** Starts on `first`; the browser's Back and Forward walk the same trail as the panel's buttons. */
/** `open` gets `travelled` true when Back or Forward brought the visit back. */
export function startTrail(first: Visit, open: (v: Visit, travelled: boolean) => void, moved: (back: boolean, forward: boolean) => void): Trail {
  let saved: Entry | null = null;
  try {
    saved = entryOf(history.state);
  } catch {
    // no history to resume
  }
  // After a reload the earlier visits are still in the browser's history, behind this one.
  let at = saved ? saved.cc : 0;
  const visits: Visit[] = new Array<Visit>(at).fill(null).concat(first);
  let browser = write(false, { cc: at, v: first });
  const report = () => moved(at > 0, at < visits.length - 1);
  const step = (to: number) => {
    at = to;
    open(visits[at]!, true);
    report();
  };
  window.addEventListener('popstate', (e) => {
    const s = entryOf(e.state);
    if (!s) return;
    visits[s.cc] = s.v;
    step(s.cc);
  });
  report();
  return {
    go(v) {
      if (v === visits[at]) return;
      at += 1;
      visits.length = at;
      visits.push(v);
      if (browser) browser = write(true, { cc: at, v });
      open(v, false);
      report();
    },
    back() {
      if (at === 0) return;
      if (browser) history.back();
      else step(at - 1);
    },
    forward() {
      if (at === visits.length - 1) return;
      if (browser) history.forward();
      else step(at + 1);
    },
  };
}
