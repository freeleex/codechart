// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.
import { boxesOfSteps, focus, link } from './focus.js';
import { sideFromHash, writeSide } from './history.js';
import type { Views } from './views.js';

/**
 * Side by side's part of the page, starting in the mode the URL names: returns what lights a node's relations and, with the mode
 * on, what it is linked to in the other pane. `refit` fits the views showing again; `repaint` redraws what depends on them (the review count).
 */
export function initSide(views: Views, refit: () => void, repaint: () => void): (id: string | null) => void {
  const boxes = boxesOfSteps();
  // A node shown is the page's moment to keep the URL in step with the mode, since a visit writes its own hash without it
  const light = (id: string | null) => {
    focus(id);
    if (id !== null && views.side()) link(id, boxes);
    writeSide(views.side());
  };
  if (sideFromHash(location.hash)) views.setSide(true);
  document.getElementById('sbs-toggle')?.addEventListener('change', () => {
    writeSide(views.side());
    refit();
    const id = document.querySelector('.node.selected')?.getAttribute('data-id');
    if (id && document.querySelector('.node.lit')) light(id);
    repaint();
  });
  return light;
}
