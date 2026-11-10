// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.
import { boxesOfSteps, focus, link } from './focus.js';
import { sideFromHash, writeSide } from './history.js';
import { COMPONENTS, type Views } from './views.js';

/** A box with no steps in the flow showing: dims that pane and says in its title row where the box's steps are, if anywhere. */
function noStepsNote(id: string, boxes: Map<string, string>, views: Views): void {
  const flow = views.showing()[1];
  if (flow === undefined || boxes.has(id) || views.of(id) !== COMPONENTS) return;
  const where = [...new Set([...boxes].filter(([, box]) => box === id).map(([step]) => views.of(step)!))];
  if (where.includes(flow)) return;
  const section = views.section(flow);
  section.classList.add('pane-dim');
  const label = document.querySelector(`.node[data-id="${CSS.escape(id)}"]`)?.getAttribute('data-label') ?? id;
  const note = document.createElement('span');
  note.className = 'pane-note';
  note.append(`No steps in ${label}`, where.length ? ' · in: ' : ' in any flow');
  where.forEach((w, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-flow', w);
    b.textContent = document.querySelector(`#flow-tabs [data-view="${CSS.escape(w)}"]`)?.textContent ?? w;
    note.append(...(i ? [' · '] : []), b);
  });
  section.querySelector('.pane-title')?.append(note);
}

/**
 * Side by side's part of the page, starting in the mode the URL names: returns what lights a node's relations and, with the mode
 * on, what it is linked to in the other pane. `refit` fits the views showing again; `repaint` redraws what depends on them (the review count).
 */
export function initSide(views: Views, refit: () => void, repaint: () => void): (id: string | null) => void {
  const boxes = boxesOfSteps();
  // A node shown is the page's moment to keep the URL in step with the mode, since a visit writes its own hash without it
  const light = (id: string | null) => {
    focus(id);
    if (id !== null && views.side()) {
      link(id, boxes);
      noStepsNote(id, boxes, views);
    }
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
  // A flow named in the note takes the right pane, and the box lights its steps there
  document.getElementById('viewpanes')?.addEventListener('click', (e) => {
    const flow = (e.target as Element).closest('[data-flow]')?.getAttribute('data-flow');
    const id = document.querySelector('.node.selected')?.getAttribute('data-id');
    if (!flow || !id) return;
    views.show(flow);
    light(id);
  });
  return light;
}
