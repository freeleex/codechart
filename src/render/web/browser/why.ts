// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.

/** Opens or closes what a button controls: the element right after it. */
function toggleNext(button: Element, open: boolean): void {
  button.setAttribute('aria-expanded', String(open));
  button.nextElementSibling!.toggleAttribute('hidden', !open);
}

/** A difference's chip opens and closes its comparison rows under it. */
export function initWhy(panel: HTMLElement): void {
  panel.addEventListener('click', (e) => {
    const button = (e.target as Element).closest('.drift-chip');
    if (button) toggleNext(button, button.getAttribute('aria-expanded') !== 'true');
  });
}

/** Opens the comparison of the panel just filled, if its node has one. */
export function expandDrift(panel: HTMLElement): void {
  const chip = panel.querySelector('.drift-chip');
  if (chip) toggleNext(chip, true);
}

/** A `[data-goto]` link's node, and whether it asks for the comparison open. */
export function gotoOf(e: Event): { id: string; expand: boolean } | null {
  const el = (e.target as Element).closest('[data-goto]');
  return el ? { id: el.getAttribute('data-goto')!, expand: el.hasAttribute('data-expand') } : null;
}
