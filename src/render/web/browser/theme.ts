// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.
import { load, save } from './store.js';

const THEMES = ['auto', 'light', 'dark'];

/** The header button cycles the theme; the choice is remembered. */
export function initTheme(): void {
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
