// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.
import { COMPONENTS } from './views.js';

/** What the panel shows: a node or step id, null for the page info, or a view with nothing selected (`viewVisit`). */
export type Visit = string | null;

// \u0001 can't be in a node id, so a view's visit never clashes with one.
export const viewVisit = (view: string): Visit => `\u0001${view}`;
export const viewOfVisit = (v: Visit): string | null => (v !== null && v.startsWith('\u0001') ? v.slice(1) : null);

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

const plainHash = (v: Visit) => (v === null ? '#info' : `#node=${encodeURIComponent(v)}`);

/** A page with views puts the view in the URL too: `#view=<id>&info` or `#view=<id>&node=<id>`. */
const viewHash = (view: string, node: string | null): string => `#view=${encodeURIComponent(view)}${node === null ? '&info' : `&node=${encodeURIComponent(node)}`}`;

let hashOf: (v: Visit) => string = plainHash;

function param(hash: string, name: string): string | null | undefined {
  const part = hash.slice(1).split('&').find((p) => p.startsWith(`${name}=`));
  if (part === undefined) return undefined;
  try {
    return decodeURIComponent(part.slice(name.length + 1));
  } catch {
    return null;
  }
}

/** The view a URL names, if any. */
const viewFromHash = (hash: string): string | undefined => param(hash, 'view') ?? undefined;

/** The visit a URL names, or undefined when it names none. A node wins over the view it is in; `#node=` alone is what older pages wrote. */
function visitFromHash(hash: string): Visit | undefined {
  if (hash === '#info') return null;
  const node = param(hash, 'node');
  if (node === null) return undefined;
  if (node !== undefined) return node;
  const view = viewFromHash(hash);
  return view === undefined ? undefined : viewVisit(view);
}

/** The visit the URL names that the page can show: a node it has, else the view that URL names, else none. */
export function shownVisit(hash: string, has: { view: (id: string) => boolean; node: (id: string) => boolean }): Visit | undefined {
  const v = visitFromHash(hash);
  if (v === undefined || v === null) return v;
  const named = viewOfVisit(v);
  if (named !== null) return has.view(named) ? v : undefined;
  if (has.node(v)) return v;
  const view = viewFromHash(hash);
  return view !== undefined && has.view(view) ? viewVisit(view) : undefined;
}

/** Side by side is a mode of the page, not a visit: the URL carries it as `&sbs=1`. */
export const sideFromHash = (hash: string): boolean => param(hash, 'sbs') === '1';

/** Puts the mode in the URL of the entry showing, or takes it out. */
export function writeSide(on: boolean): void {
  const parts = location.hash.slice(1).split('&').filter((p) => p && p !== 'sbs=1');
  const hash = parts.length || on ? `#${[...parts, ...(on ? ['sbs=1'] : [])].join('&')}` : '';
  if (hash === location.hash) return;
  try {
    history.replaceState(history.state, '', location.pathname + location.search + hash);
  } catch {
    // sandboxed frames may refuse; the mode then lives only in this page
  }
}

/** A page with views: the URL of a visit, with the view the node is in. */
function viewUrl(v: Visit, viewOf: (node: string) => string | undefined): string {
  const named = viewOfVisit(v);
  if (named !== null) return viewHash(named, null);
  return viewHash(v === null ? COMPONENTS : (viewOf(v) ?? COMPONENTS), v);
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
export function startTrail(asked: () => Visit | undefined, open: (v: Visit, travelled: boolean) => void, moved: (back: boolean, forward: boolean) => void, viewOf?: (node: string) => string | undefined): Trail {
  hashOf = viewOf ? (v) => viewUrl(v, viewOf) : plainHash;
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
