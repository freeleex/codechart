// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.
import { load, save } from './store.js';

/** The drag handle between canvas and panel: its width is remembered, per page kind. */
export function initPanelResize(): void {
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
