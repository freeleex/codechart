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
  document.querySelectorAll('.lit').forEach((el) => el.classList.remove('lit'));
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
