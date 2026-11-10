// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.

/** Marks the node as the one the panel shows. */
export function select(id: string | null): void {
  document.querySelectorAll('.node.selected').forEach((g) => g.classList.remove('selected'));
  if (id === null) return;
  document.querySelectorAll(`.node[data-id="${CSS.escape(id)}"]`).forEach((g) => g.classList.add('selected'));
}

/** Lights the node, its edges and its neighbours and dims the rest; null lights everything again. */
export function focus(id: string | null): void {
  document.body.classList.toggle('focus', id !== null);
  document.querySelectorAll('.lit, .linked, .pane-dim').forEach((el) => el.classList.remove('lit', 'linked', 'pane-dim'));
  if (id === null) return;
  const near = new Set([id]);
  document.querySelectorAll('.edge').forEach((e) => {
    const from = e.getAttribute('data-from')!;
    const to = e.getAttribute('data-to')!;
    if (from !== id && to !== id) return;
    e.classList.add('lit');
    near.add(from).add(to);
  });
  document.querySelectorAll('.node').forEach((g) => g.classList.toggle('lit', near.has(g.getAttribute('data-id')!)));
}

/** The box each flow step happens in, read from the "Part of" link in the step's panel. */
export function boxesOfSteps(): Map<string, string> {
  const boxes = new Map<string, string>();
  document.querySelectorAll<HTMLTemplateElement>('template.card-panel').forEach((t) => {
    const box = t.content.querySelector('.partof [data-goto]')?.getAttribute('data-goto');
    if (box) boxes.set(t.getAttribute('data-for')!, box);
  });
  return boxes;
}

/**
 * Side by side, after `focus(id)`: lights in the other pane what the clicked node is linked to (a step's box, or the steps of
 * the flow showing that happen in a box) with the selected look, and dims each pane on its own, so a pane with nothing linked stays clear.
 */
export function link(id: string, boxes: Map<string, string>): void {
  const mine = document.querySelector(`.node[data-id="${CSS.escape(id)}"]`)?.closest('.view');
  if (!mine) return;
  document.body.classList.remove('focus');
  mine.classList.add('pane-dim');
  const to = boxes.has(id) ? [boxes.get(id)!] : [...boxes].filter(([, box]) => box === id).map(([step]) => step);
  const hits = to.flatMap((t) => [...document.querySelectorAll(`.view:not([hidden]) .node[data-id="${CSS.escape(t)}"]`)]);
  hits.forEach((g) => g.classList.add('lit', 'linked'));
  hits[0]?.closest('.view')?.classList.add('pane-dim');
}

/** Esc or a click on the empty canvas (not the end of a pan) lights everything again. */
export function dismissFocus(canvases: HTMLElement[], panned: () => boolean): void {
  canvases.forEach((canvas) =>
    canvas.addEventListener('click', (e) => {
      if (!(e.target as Element).closest('.node') && !panned()) focus(null);
    }),
  );
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') focus(null);
  });
}
