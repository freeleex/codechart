// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.

export const COMPONENTS = 'components';

export interface Views {
  /** The id of the view showing. */
  active(): string;
  /** The section of the view showing. */
  section(): HTMLElement;
  has(id: string): boolean;
  /** The view a node or step is drawn in. */
  of(nodeId: string): string | undefined;
  /** Shows the view and its toolbar parts and tabs. */
  show(id: string): void;
}

/**
 * Views are the page's `.view` sections, one canvas each, one shown at a time: Components and one per flow. `go` asks the page to
 * visit a view (a tab was clicked); `shown` runs after a view is shown. None on a page without views.
 */
export function initViews(go: (id: string) => void, shown: (id: string) => void): Views | null {
  const sections = [...document.querySelectorAll<HTMLElement>('.view')];
  if (!sections.length) return null;
  const idOf = (s: HTMLElement) => s.getAttribute('data-view')!;
  const flowTabs = document.getElementById('flow-tabs')!;
  let active = idOf(sections[0]!);
  let lastFlow: string | undefined;
  const views: Views = {
    active: () => active,
    section: () => sections.find((s) => idOf(s) === active)!,
    has: (id) => sections.some((s) => idOf(s) === id),
    of: (nodeId) => {
      const g = [...document.querySelectorAll('.node')].find((n) => n.getAttribute('data-id') === nodeId);
      const section = g?.closest<HTMLElement>('.view');
      return section ? idOf(section) : undefined;
    },
    show(id) {
      active = id;
      if (id !== COMPONENTS) lastFlow = id;
      sections.forEach((s) => (s.hidden = idOf(s) !== id));
      document.querySelectorAll('#view-tabs [data-tab]').forEach((t) => t.setAttribute('aria-selected', String((t.getAttribute('data-tab') === COMPONENTS) === (id === COMPONENTS))));
      flowTabs.hidden = id === COMPONENTS;
      flowTabs.querySelectorAll('[data-view]').forEach((t) => t.setAttribute('aria-selected', String(t.getAttribute('data-view') === id)));
      document.querySelectorAll<HTMLElement>('[data-only-view]').forEach((e) => (e.hidden = e.getAttribute('data-only-view') !== id));
      shown(id);
    },
  };
  const firstFlow = flowTabs.querySelector('[data-view]')?.getAttribute('data-view') ?? undefined;
  document.getElementById('view-bar')!.addEventListener('click', (e) => {
    const t = (e.target as Element).closest('button');
    if (!t) return;
    const id = t.hasAttribute('data-view') ? t.getAttribute('data-view')! : t.getAttribute('data-tab') === COMPONENTS ? COMPONENTS : (lastFlow ?? firstFlow);
    if (id !== undefined && id !== active) go(id);
  });
  return views;
}
