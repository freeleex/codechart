// Runs in the generated page; scripts/client-build.ts puts it ahead of client.ts in the one inline script.

export const COMPONENTS = 'components';

export interface Views {
  /** The id of the view last shown: the one a click in a canvas was in, or the tab picked. */
  active(): string;
  /** The ids of the views on screen: `active`, or with side by side Components and the flow chosen. */
  showing(): string[];
  /** The section of a view. */
  section(id: string): HTMLElement;
  has(id: string): boolean;
  /** The view a node or step is drawn in. */
  of(nodeId: string): string | undefined;
  /** Shows the view and its toolbar parts and tabs. */
  show(id: string): void;
  side(): boolean;
  /** Turns side by side on or off, keeping the views as they are. */
  setSide(on: boolean): void;
}

const idOf = (s: HTMLElement) => s.getAttribute('data-view')!;

/** Shows the sections of `ids` and sets the tab rows and the toolbar parts to match. */
function paint(sections: HTMLElement[], ids: string[], active: string, side: boolean, flow: string | undefined): void {
  const flowTabs = document.getElementById('flow-tabs')!;
  sections.forEach((s) => (s.hidden = !ids.includes(idOf(s))));
  document.body.classList.toggle('sbs', side);
  // With side by side both views show, so neither main tab is the one
  document.querySelectorAll('#view-tabs [data-tab]').forEach((t) => t.setAttribute('aria-selected', String(!side && (t.getAttribute('data-tab') === COMPONENTS) === (active === COMPONENTS))));
  flowTabs.hidden = !side && active === COMPONENTS;
  flowTabs.querySelectorAll('[data-view]').forEach((t) => t.setAttribute('aria-selected', String(t.getAttribute('data-view') === flow)));
  document.querySelectorAll<HTMLElement>('[data-only-view]').forEach((e) => (e.hidden = !ids.includes(e.getAttribute('data-only-view')!)));
}

/** The view a node or step is drawn in. */
function viewOf(nodeId: string): string | undefined {
  const g = [...document.querySelectorAll('.node')].find((n) => n.getAttribute('data-id') === nodeId);
  const section = g?.closest<HTMLElement>('.view');
  return section ? idOf(section) : undefined;
}

/**
 * Views are the page's `.view` sections, one canvas each, one shown at a time (Components and the chosen flow together with side
 * by side): Components and one per flow. `go` asks the page to visit a view (a tab was clicked); `shown` runs after a view is
 * shown. None on a page without views.
 */
export function initViews(go: (id: string) => void, shown: (id: string) => void): Views | null {
  const sections = [...document.querySelectorAll<HTMLElement>('.view')];
  if (!sections.length) return null;
  const toggle = document.getElementById('sbs-toggle') as HTMLInputElement | null;
  const firstFlow = document.querySelector('#flow-tabs [data-view]')?.getAttribute('data-view') ?? undefined;
  let active = idOf(sections[0]!);
  let lastFlow: string | undefined;
  let side = false;
  const flow = () => lastFlow ?? firstFlow;
  const showing = () => (side && flow() !== undefined ? [COMPONENTS, flow()!] : [active]);
  const render = () => paint(sections, showing(), active, side, flow());
  const views: Views = {
    active: () => active,
    showing,
    section: (id) => sections.find((s) => idOf(s) === id)!,
    has: (id) => sections.some((s) => idOf(s) === id),
    of: viewOf,
    show(id) {
      active = id;
      if (id !== COMPONENTS) lastFlow = id;
      render();
      shown(id);
    },
    side: () => side,
    setSide(on) {
      side = on;
      if (toggle) toggle.checked = on;
      render();
    },
  };
  toggle?.addEventListener('change', () => views.setSide(toggle.checked));
  document.getElementById('view-bar')!.addEventListener('click', (e) => {
    const t = (e.target as Element).closest('button');
    if (!t) return;
    const main = !t.hasAttribute('data-view');
    // The main tabs show one view each, so picking one ends side by side, as the switch would
    if (main && side && toggle) {
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change'));
    }
    const id = !main ? t.getAttribute('data-view')! : t.getAttribute('data-tab') === COMPONENTS ? COMPONENTS : flow();
    if (id !== undefined && id !== active) go(id);
  });
  return views;
}
