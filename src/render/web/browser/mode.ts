// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.
import { load, save } from './store.js';

const MODE_KEY = 'codechart.mode';

export const isFull = (): boolean => document.documentElement.getAttribute('data-mode') === 'full';

/** The header's Light / Full switch, remembered. Pages without it (no diffs) are always Full. `panel` holds the "see all in Full" links. */
export function initMode(panel: HTMLElement): void {
  const btn = document.getElementById('mode-toggle');
  if (!btn) return;
  const set = (full: boolean, remember: boolean) => {
    document.documentElement.setAttribute('data-mode', full ? 'full' : 'light');
    btn.textContent = `Mode: ${full ? 'Full' : 'Light'}`;
    if (remember) save(MODE_KEY, full ? 'full' : 'light');
  };
  set(load(MODE_KEY) === 'full', false);
  btn.addEventListener('click', () => set(!isFull(), true));
  panel.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-mode-set="full"]')) set(true, true);
  });
}
