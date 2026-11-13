import { readFileSync } from 'node:fs';
import { afterEach, beforeEach } from 'vitest';
import { renderFlowHtml } from '../../src/render/flow/html.js';
import { layoutFlow } from '../../src/render/flow/layout.js';
import type { Preview } from '../../src/render/preview.js';
import { renderHtml } from '../../src/render/web/html.js';
import { layoutSpec, PANE_CANVASES } from '../../src/render/web/layout.js';
import { validateSpec, type Spec } from '../../src/spec/schema.js';
import { sampleFlow, sampleSnippets } from '../render/flow-fixture.js';

function mapSpec(raw: unknown): Spec {
  const r = validateSpec(raw);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  if (r.spec.diagram === 'flow') throw new Error('expected map spec');
  return r.spec;
}

const meta = { generatedAt: new Date('2026-11-05T12:00:00Z'), repo: 'demo' };
const shop = mapSpec(JSON.parse(readFileSync('tests/fixtures/shop.spec.json', 'utf8')));
const shopLayout = await layoutSpec(shop);
/** A one-pane map: new, changed, context and config nodes. */
export const shopPage = renderHtml(shop, shopLayout, meta);
/** The same map for another repo, with node diffs. */
export const shopWith = (previews: Map<string, Preview>, repo = 'demo', repoKey?: string) =>
  renderHtml(shop, shopLayout, { ...meta, repo, ...(repoKey && { repoKey }) }, undefined, { previews });

/** What a page paired with a review file carries. */
export const change = { slug: 'shop', branch: 'feat/invoices', at: '2026-11-05T12:00:00.000Z' };
/** The shop map as a page that takes notes. */
export const shopNotes = (previews?: Map<string, Preview>) => renderHtml(shop, shopLayout, { ...meta, change }, undefined, { previews });

const plan = mapSpec({
  title: 'Users join teams',
  kind: 'plan',
  nodes: [
    { id: 'users', label: 'users', kind: 'table', status: 'changed', layer: 'database' },
    { id: 'legacy', label: 'legacy_roles', kind: 'table', status: 'removed', layer: 'database' },
    { id: 'teams', label: 'teams', kind: 'table', status: 'new', layer: 'database' },
    { id: 'api', label: 'GET /users', kind: 'endpoint', status: 'changed', layer: 'backend' },
    { id: 'svc', label: 'RoleService', kind: 'service', status: 'context', layer: 'backend' },
    { id: 'mailer', label: 'Mailer', kind: 'service', status: 'config', layer: 'backend' },
  ],
  edges: [
    { from: 'api', to: 'users', label: 'reads', kind: 'reads' },
    { from: 'users', to: 'teams', label: 'team_id', kind: 'fk' },
    { from: 'users', to: 'legacy', label: 'role_id', kind: 'fk' },
    { from: 'api', to: 'svc', label: 'roles()', kind: 'calls' },
  ],
});
/** A Now / After map. */
export const panesPage = renderHtml(plan, await layoutSpec(plan, PANE_CANVASES), meta);

const flow = sampleFlow();
export const flowPage = renderFlowHtml(flow, await layoutFlow(flow), sampleSnippets(), meta);
export const flowNotes = renderFlowHtml(flow, await layoutFlow(flow), sampleSnippets(), { ...meta, change });
export const panesNotes = renderHtml(plan, await layoutSpec(plan, PANE_CANVASES), { ...meta, change });

export const q = <T extends Element>(sel: string) => document.querySelector(sel) as T;
export const qa = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
export const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
/** In pane `pane`; a page with views has one canvas per view, so a node not in the pane is looked for in them all. */
export const node = (id: string, pane = 0) => (qa<SVGGElement>('.canvas')[pane]!.querySelector(`.node[data-id="${id}"]`) ?? document.querySelector(`.node[data-id="${id}"]`)) as SVGGElement;
export const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));

const added: [string, EventListenerOrEventListenerObject][] = [];
const addListener = window.addEventListener.bind(window);

/** Runs the page's script in happy-dom; `fresh` false keeps the saved settings, as a reload does; `hash` is the URL's, null keeps the current history entry too. */
export function mount(html: string, fresh = true, hash: string | null = ''): void {
  for (const [type, fn] of added.splice(0)) window.removeEventListener(type, fn);
  if (hash !== null) history.replaceState(null, '', `/${hash}`);
  if (fresh) localStorage.clear();
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
  for (const s of document.querySelectorAll('script')) if (s.type !== 'application/json') new Function(s.textContent ?? '')();
}

/** Each mount runs the page script again; the window listeners of the last one go. */
export function usePages(): void {
  beforeEach(() => {
    if (!('escape' in CSS)) {
      (CSS as { escape?: (s: string) => string }).escape = (s) => s.replace(/([^\w-])/g, '\\$1');
    }
    window.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: AddEventListenerOptions) => {
      added.push([type, fn]);
      addListener(type, fn, opts);
    }) as typeof window.addEventListener;
  });
  afterEach(() => {
    for (const [type, fn] of added.splice(0)) window.removeEventListener(type, fn);
    window.addEventListener = addListener;
  });
}
