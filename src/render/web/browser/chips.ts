// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.
import { load, save } from './store.js';

const KEY = 'codechart.faded';

function savedStatuses(): string[] {
  try {
    const v = JSON.parse(load(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/** Header chips: one per status fades its nodes and their edges; "Δ changes only" fades the unchanged ones. The choice is remembered. */
export function initChips(): void {
  const chips = [...document.querySelectorAll<HTMLElement>('#chips .chip')];
  if (!chips.length) return;
  const present = chips.flatMap((c) => c.getAttribute('data-status') ?? []);
  const faded = new Set(savedStatuses().filter((s) => present.includes(s)));
  const statusOf = (c: Element) => c.getAttribute('data-delta') ?? c.getAttribute('data-status')!;
  const apply = () => {
    const nodeStatus = new Map<string, string>();
    document.querySelectorAll('.node').forEach((g) => {
      const status = g.getAttribute('data-status')!;
      nodeStatus.set(g.getAttribute('data-id')!, status);
      g.classList.toggle('faded', faded.has(status));
    });
    document.querySelectorAll('.edge').forEach((e) => {
      const ends = [e.getAttribute('data-from')!, e.getAttribute('data-to')!];
      e.classList.toggle('faded', ends.some((id) => faded.has(nodeStatus.get(id) ?? '')));
    });
    chips.forEach((c) => {
      const unchanged = c.getAttribute('data-delta');
      const on = unchanged === null ? faded.has(statusOf(c)) : faded.size === 1 && faded.has(unchanged);
      c.setAttribute('aria-pressed', String(on));
    });
  };
  chips.forEach((c) =>
    c.addEventListener('click', () => {
      const status = statusOf(c);
      if (c.hasAttribute('data-delta')) {
        const was = faded.size === 1 && faded.has(status);
        faded.clear();
        if (!was) faded.add(status);
      } else if (!faded.delete(status)) faded.add(status);
      save(KEY, JSON.stringify([...faded]));
      apply();
    }),
  );
  apply();
}
