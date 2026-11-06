// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.

export interface View {
  x: number;
  y: number;
  k: number;
}

const ZOOM_MAX = 2.5;
const FILL = 0.6;
const GLIDE_MS = 250;

/** The view that centres a box and zooms it to fill about 60% of the pane, never past 2.5x. */
export function nodeView(b: { x: number; y: number; width: number; height: number }, pane: { width: number; height: number }): View {
  const k = Math.min(ZOOM_MAX, (pane.width * FILL) / (b.width || 1), (pane.height * FILL) / (b.height || 1));
  return { k, x: pane.width / 2 - (b.x + b.width / 2) * k, y: pane.height / 2 - (b.y + b.height / 2) * k };
}

/** Eases from one view to another, calling `set` each frame; returns what cancels it. Reduced motion jumps. */
export function glide(from: View, to: View, set: (v: View) => void): () => void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !window.requestAnimationFrame) {
    set(to);
    return () => {};
  }
  let live = true;
  const t0 = performance.now();
  const step = (now: number) => {
    if (!live) return;
    const f = Math.min(1, (now - t0) / GLIDE_MS);
    const e = 1 - (1 - f) ** 3;
    set({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e });
    if (f < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return () => {
    live = false;
  };
}
