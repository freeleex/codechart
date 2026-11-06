// Runs in the generated page, not in node. `npm run gen:client` compiles it into ../client.ts,
// which the page inlines (the CSP allows that one script by hash).
import { initChips } from './chips.js';
import { dismissFocus, focus, select } from './focus.js';
import { initHunks } from './hunks.js';
import { startTrail, visitFromHash, type Trail, type Visit } from './history.js';
import { initMode } from './mode.js';
import { initReview } from './review.js';
import { load, save } from './store.js';

interface View {
  x: number;
  y: number;
  k: number;
}

interface Drag {
  i: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  canvas: HTMLElement;
}

const THEMES = ['auto', 'light', 'dark'];

const data = JSON.parse(document.getElementById('spec-data')!.textContent!) as { width: number; height: number; repoKey: string };
const canvases = [...document.querySelectorAll<HTMLElement>('.canvas')];
const vps = [...document.querySelectorAll<SVGGElement>('.viewport')];
const panel = document.getElementById('panel')!;
const info = document.getElementById('page-info')!;
const infoBtn = document.getElementById('info-toggle');

// One transform per pane; while linked, a move in one is copied to all so Now and After stay aligned.
let ts: View[] = canvases.map(() => ({ x: 0, y: 0, k: 1 }));
let linked = true;
let last = 0;
let drag: Drag | null = null;
let moved = false;
let trail: Trail;

function apply(): void {
  vps.forEach((vp, i) => {
    const t = ts[i]!;
    vp.setAttribute('transform', `translate(${t.x},${t.y}) scale(${t.k})`);
  });
}

function move(i: number, t: View): void {
  last = i;
  ts = ts.map((old, j) => (linked || j === i ? { x: t.x, y: t.y, k: t.k } : old));
  apply();
}

function fit(): void {
  const r = canvases[0]!.querySelector('svg')!.getBoundingClientRect();
  const k = Math.min(r.width / data.width, r.height / data.height, 1) || 1;
  const t = { k, x: (r.width - data.width * k) / 2, y: (r.height - data.height * k) / 2 };
  ts = ts.map(() => ({ x: t.x, y: t.y, k: t.k }));
  apply();
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
  if (infoBtn) infoBtn.setAttribute('aria-expanded', String(on));
}

const panelFor = (id: string) => document.querySelector<HTMLTemplateElement>(`template.card-panel[data-for="${CSS.escape(id)}"]`);

function open(v: Visit): void {
  const tpl = v === null ? null : panelFor(v);
  select(tpl ? v : null);
  focus(tpl ? v : null);
  if (tpl) {
    panel.textContent = '';
    panel.appendChild(tpl.content.cloneNode(true));
  }
  setInfo(!tpl);
  review.paint();
  hunks.reset();
}

/** Pans so the node is in the middle of each pane it is outside of. */
function reveal(v: Visit): void {
  if (v === null) return;
  canvases.forEach((canvas, i) => {
    const g = canvas.querySelector(`.node[data-id="${CSS.escape(v)}"]`);
    if (!g) return;
    const c = canvas.getBoundingClientRect();
    const r = g.getBoundingClientRect();
    if (r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom) return;
    const t = ts[i]!;
    move(i, { x: t.x + (c.left + c.right - r.left - r.right) / 2, y: t.y + (c.top + c.bottom - r.top - r.bottom) / 2, k: t.k });
  });
}

/** Opens the node as a visit and lights its relations. */
function visit(id: string): void {
  if (!panelFor(id)) return;
  trail.go(id);
  focus(id);
}

function goTo(id: string): void {
  visit(id);
  reveal(id);
}

function initPanel(): void {
  const backBtn = document.getElementById('nav-back') as HTMLButtonElement;
  const forwardBtn = document.getElementById('nav-forward') as HTMLButtonElement;
  const asked = () => {
    const v = visitFromHash(location.hash);
    return v === undefined || (v !== null && !panelFor(v)) ? undefined : v;
  };
  const show = (v: Visit, travelled: boolean) => {
    open(v);
    if (travelled) reveal(v);
  };
  trail = startTrail(asked, show, (back, forward) => {
    backBtn.disabled = !back;
    forwardBtn.disabled = !forward;
  });
  backBtn.addEventListener('click', () => trail.back());
  forwardBtn.addEventListener('click', () => trail.forward());
  window.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    // At either end the browser's own shortcut takes over, leaving the page.
    if (e.key === 'ArrowLeft' ? trail.back() : trail.forward()) e.preventDefault();
  });
  panel.addEventListener('click', (e) => {
    const to = (e.target as Element).closest('[data-goto]')?.getAttribute('data-goto');
    if (to) goTo(to);
  });
  const showInfo = () => trail.go(null);
  if (infoBtn) infoBtn.addEventListener('click', showInfo);
  const checkBtn = document.querySelector('header .check.bad');
  if (checkBtn) checkBtn.addEventListener('click', showInfo);
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

function initTheme(): void {
  const root = document.documentElement;
  const btn = document.getElementById('theme-toggle')!;
  const setTheme = (v: string, remember: boolean) => {
    root.setAttribute('data-theme', v);
    btn.textContent = `Theme: ${v}`;
    if (remember) save('codechart.theme', v);
  };
  const saved = load('codechart.theme');
  setTheme(saved !== null && THEMES.includes(saved) ? saved : root.getAttribute('data-theme')!, false);
  btn.addEventListener('click', () => {
    const i = THEMES.indexOf(root.getAttribute('data-theme')!);
    setTheme(THEMES[(i + 1) % THEMES.length]!, true);
  });
}

function initPanelResize(): void {
  const aside = document.querySelector('aside')!;
  const handle = document.getElementById('resize')!;
  let width = 0;
  // Two panes need the room, so their panel starts at half width and remembers its own size.
  const panes = !!document.getElementById('panes');
  const widthKey = panes ? 'codechart.panel.panes' : 'codechart.panel';
  const minWidth = panes ? 200 : 300;
  const setWidth = (w: number, remember: boolean) => {
    width = Math.round(Math.max(minWidth, Math.min(w, window.innerWidth * 0.8)));
    aside.style.width = `${width}px`;
    if (remember) save(widthKey, String(width));
  };
  const currentWidth = () => width || aside.getBoundingClientRect().width;
  const savedWidth = Number(load(widthKey));
  if (savedWidth > 0) setWidth(savedWidth, false);
  let sizing = false;
  handle.addEventListener('pointerdown', (e) => {
    sizing = true;
    handle.classList.add('drag');
    if (handle.setPointerCapture) handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (sizing) setWidth(window.innerWidth - e.clientX, false);
  });
  const endSize = () => {
    if (!sizing) return;
    sizing = false;
    handle.classList.remove('drag');
    setWidth(currentWidth(), true);
  };
  handle.addEventListener('pointerup', endSize);
  handle.addEventListener('pointercancel', endSize);
  handle.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowLeft' ? 40 : e.key === 'ArrowRight' ? -40 : 0;
    if (!step) return;
    e.preventDefault();
    setWidth(currentWidth() + step, true);
  });
}

initPanZoom();
initPaneLink();
initTheme();
initMode(panel);
initPanelResize();
window.addEventListener('resize', fit);
fit();
dismissFocus(canvases, () => moved);
initChips();
const review = initReview(data.repoKey, goTo);
const hunks = initHunks(panel, review);
initPanel();
