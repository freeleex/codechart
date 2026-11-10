// Runs in the generated page, not in node. `npm run gen:client` compiles it into ../client.ts,
// which the page inlines (the CSP allows that one script by hash).
import { initBusiness } from './business.js';
import { initChips } from './chips.js';
import { initComments } from './comments.js';
import { initFinish } from './finish.js';
import { dismissFocus, focus, select } from './focus.js';
import { glide, nodeView, revealView, type View } from './glide.js';
import { initHunks } from './hunks.js';
import { initPanelResize } from './resize.js';
import { shownVisit, startTrail, viewOfVisit, viewVisit, type Trail, type Visit } from './history.js';
import { initSide } from './side.js';
import { initReview } from './review.js';
import { load, save } from './store.js';
import { initTheme } from './theme.js';
import { COMPONENTS, initViews, type Views } from './views.js';
import { expandDrift, gotoOf, initWhy } from './why.js';

interface Drag {
  i: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  canvas: HTMLElement;
}

const data = JSON.parse(document.getElementById('spec-data')!.textContent!) as { page?: string; width: number; height: number; views?: { id: string; width: number; height: number }[]; repoKey: string; change?: { slug: string; branch: string; at: string } };
const canvases = [...document.querySelectorAll<HTMLElement>('.canvas')];
const vps = [...document.querySelectorAll<SVGGElement>('.viewport')];
const panel = document.getElementById('panel')!;
const info = document.getElementById('page-info')!;
const rel = document.getElementById('panel-rel')!;
/** A link from the differences list asks for its node's comparison open. */
let expand = false;
const infoBtn = document.getElementById('info-toggle');
const focusBtn = document.getElementById('nav-focus') as HTMLButtonElement;

// One transform per pane; while linked, a move in one is copied to all so Now and After stay aligned.
let ts: View[] = canvases.map(() => ({ x: 0, y: 0, k: 1 }));
// Panes that share a view move together while linked; a page with views has one canvas in each.
const sections = canvases.map((c) => c.closest('.view'));
let views: Views | null = null;
const fitted = new Set<string>();
let linked = true;
let last = 0;
let drag: Drag | null = null;
let moved = false;
let trail: Trail;
let stopGlide = (): void => {};
// Side by side also lights what a node is linked to in the other pane
let light: (id: string | null) => void = focus;

function apply(): void {
  vps.forEach((vp, i) => {
    const t = ts[i]!;
    vp.setAttribute('transform', `translate(${t.x},${t.y}) scale(${t.k})`);
  });
}

function move(i: number, t: View): void {
  last = i;
  ts = ts.map((old, j) => ((linked && sections[j] === sections[i]) || j === i ? { x: t.x, y: t.y, k: t.k } : old));
  apply();
}

/** Zooms in on the selected node and centres it. Linked panes follow the first pane that has it. */
function zoomToSelected(): void {
  const id = document.querySelector('.node.selected')?.getAttribute('data-id');
  if (!id) return;
  stopGlide();
  const stops: (() => void)[] = [];
  for (let i = 0; i < canvases.length; i++) {
    const g = canvases[i]!.querySelector<SVGGraphicsElement>(`.node[data-id="${CSS.escape(id)}"]`);
    if (!g) continue;
    stops.push(glide(ts[i]!, nodeView(g.getBBox(), canvases[i]!.querySelector('svg')!.getBoundingClientRect()), (v) => move(i, v)));
    if (linked) break;
  }
  stopGlide = () => stops.forEach((s) => s());
}

/** Fits the views showing (the only canvas without views) to their canvases, each on its own; with `all` false, just those not fitted yet. */
function fit(all = true): void {
  for (const id of views ? views.showing() : [undefined]) {
    if (id !== undefined && !all && fitted.has(id)) continue;
    const section = id === undefined ? null : views!.section(id);
    const dims = data.views?.find((v) => v.id === id) ?? data;
    const r = canvases[sections.indexOf(section)]!.querySelector('svg')!.getBoundingClientRect();
    const k = Math.min(r.width / dims.width, r.height / dims.height, 1) || 1;
    const t = { k, x: (r.width - dims.width * k) / 2, y: (r.height - dims.height * k) / 2 };
    ts = ts.map((old, j) => (sections[j] === section ? { x: t.x, y: t.y, k: t.k } : old));
    if (id !== undefined) fitted.add(id);
  }
  apply();
}

/** A view's canvas has no size while hidden, so it is fitted when first shown; a resize refits those showing. */
function refit(): void {
  stopGlide();
  fitted.clear();
  fit();
}

function endDrag(): void {
  if (drag) drag.canvas.classList.remove('drag');
  drag = null;
}

function initPanZoom(): void {
  canvases.forEach((canvas, i) => {
    const svg = canvas.querySelector('svg')!;
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        stopGlide();
        const t = ts[i]!;
        const r = svg.getBoundingClientRect();
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        const k = Math.min(4, Math.max(0.1, t.k * Math.exp(-e.deltaY * 0.0015)));
        move(i, { x: px - ((px - t.x) / t.k) * k, y: py - ((py - t.y) / t.k) * k, k });
      },
      { passive: false },
    );
    canvas.addEventListener('pointerdown', (e) => {
      stopGlide();
      drag = { i, x: e.clientX - ts[i]!.x, y: e.clientY - ts[i]!.y, sx: e.clientX, sy: e.clientY, canvas };
      moved = false;
    });
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) {
      moved = true;
      drag.canvas.classList.add('drag');
    }
    if (!moved) return;
    move(drag.i, { x: e.clientX - drag.x, y: e.clientY - drag.y, k: ts[drag.i]!.k });
  });
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
}

function initPaneLink(): void {
  const linkBtn = document.getElementById('link-toggle');
  if (!linkBtn) return;
  const setLinked = (on: boolean, remember: boolean) => {
    linked = on;
    linkBtn.textContent = `Panes: ${on ? 'linked' : 'separate'}`;
    linkBtn.setAttribute('aria-pressed', String(on));
    if (on) move(last, ts[last]!);
    if (remember) save('codechart.panes.linked', on ? '1' : '0');
  };
  setLinked(load('codechart.panes.linked') !== '0', false);
  linkBtn.addEventListener('click', () => setLinked(!linked, true));
}

function setInfo(on: boolean): void {
  info.hidden = !on;
  panel.hidden = on;
  rel.hidden = on || !rel.hasChildNodes();
  if (infoBtn) infoBtn.setAttribute('aria-expanded', String(on));
}

const panelFor = (id: string) => document.querySelector<HTMLTemplateElement>(`template.card-panel[data-for="${CSS.escape(id)}"]`);

function open(v: Visit): void {
  const view = viewOfVisit(v);
  const id = view === null ? v : null;
  const tpl = id === null ? null : panelFor(id);
  // The page info of a page with views is its Components view's.
  const shown = view ?? (id === null ? (views ? COMPONENTS : undefined) : tpl ? views?.of(id) : undefined);
  if (shown !== undefined && views) views.show(shown);
  select(tpl ? id : null);
  light(tpl ? id : null);
  if (tpl) {
    const filled = tpl.content.cloneNode(true) as DocumentFragment;
    panel.textContent = '';
    const footer = filled.querySelector('.prel');
    rel.replaceChildren(...(footer?.childNodes ?? []));
    footer?.remove();
    panel.appendChild(filled);
    if (expand) expandDrift(panel);
  }
  setInfo(!tpl);
  focusBtn.disabled = !tpl;
  review.paint();
  comments?.paint();
  hunks.reset();
}

/** Pans so the node is in the middle of each pane it is outside of. */
function reveal(v: Visit): void {
  if (v === null) return;
  canvases.forEach((canvas, i) => {
    const g = canvas.querySelector(`.node[data-id="${CSS.escape(v)}"]`);
    const t = g && revealView(ts[i]!, canvas.getBoundingClientRect(), g.getBoundingClientRect());
    if (t) move(i, t);
  });
}

/** Opens the node as a visit and lights its relations. */
function visit(id: string): void {
  if (!panelFor(id)) return;
  trail.go(id);
  light(id);
}

function goTo(id: string): void {
  visit(id);
  reveal(id);
}

function goToExpanded(id: string, open: boolean): void {
  expand = open;
  goTo(id);
  expand = false;
}

function initPanel(): void {
  const backBtn = document.getElementById('nav-back') as HTMLButtonElement;
  const forwardBtn = document.getElementById('nav-forward') as HTMLButtonElement;
  const asked = () => shownVisit(location.hash, { view: (id) => Boolean(views?.has(id)), node: (id) => panelFor(id) !== null });
  const show = (v: Visit, travelled: boolean) => {
    open(v);
    if (travelled) reveal(v);
  };
  trail = startTrail(asked, show, (back, forward) => {
    backBtn.disabled = !back;
    forwardBtn.disabled = !forward;
  }, views?.of); // a page with views names the view in the URL as well
  backBtn.addEventListener('click', () => trail.back());
  forwardBtn.addEventListener('click', () => trail.forward());
  focusBtn.addEventListener('click', zoomToSelected);
  window.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    // At either end the browser's own shortcut takes over, leaving the page.
    if (e.key === 'ArrowLeft' ? trail.back() : trail.forward()) e.preventDefault();
  });
  for (const el of [panel, info, rel]) {
    el.addEventListener('click', (e) => {
      const link = gotoOf(e);
      if (link) goToExpanded(link.id, link.expand);
    });
  }
  const showInfo = () => trail.go(views ? viewVisit(views.active()) : null);
  if (infoBtn) infoBtn.addEventListener('click', showInfo);
  document.querySelectorAll('header button.check').forEach((b) => b.addEventListener('click', showInfo));
  document.querySelectorAll<SVGGElement>('.node').forEach((g) => {
    const go = () => visit(g.getAttribute('data-id')!);
    g.addEventListener('click', () => {
      if (!moved) go();
    });
    g.addEventListener('keydown', (e) => {
      if (e.target !== g) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });
  });
}

let review: ReturnType<typeof initReview>, comments: ReturnType<typeof initComments> | null = null, hunks: ReturnType<typeof initHunks>;
function initMap(): void {
  initPanZoom();
  initPaneLink();
  initTheme();
  initPanelResize();
  window.addEventListener('resize', refit);
  views = initViews((id) => trail.go(viewVisit(id)), () => fit(false));
  if (views) light = initSide(views, refit, () => review.paint());
  fit();
  dismissFocus(canvases, () => moved);
  initChips();
  initWhy(panel);
  review = initReview(data.repoKey, goTo);
  comments = data.change ? initComments(data.repoKey, data.change) : null;
  if (comments && data.change) initFinish(comments, data.change);
  hunks = initHunks(panel, review, zoomToSelected);
  initPanel();
}
if (data.page === 'business') initBusiness(data.repoKey, data.change); else initMap();
