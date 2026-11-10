// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { renderHtml } from '../../src/render/web/html.js';
import { layoutSpec } from '../../src/render/web/layout.js';
import { validateSpec } from '../../src/spec/schema.js';
import { explain, withFlows } from '../fixtures/explain.js';
import { explainFlowsPage, explainRepo } from '../helpers/explain-flows.js';
import { change, click, key, mount, q, qa, usePages } from '../helpers/page.js';

usePages();

let repo: string;
beforeAll(() => {
  repo = explainRepo();
});

const draw = (raw: object = withFlows(), notes = false) => explainFlowsPage(repo, raw, notes ? change : undefined);
const STEP = 'flow:create/zero';
const NOTES_KEY = `codechart.notes:demo:${change.slug}:${change.at}`;
const el = (id: string) => q<SVGGElement>(`.node[data-id="${id}"]`);
const tab = (name: string) => q<HTMLButtonElement>(`#view-tabs [data-tab="${name}"]`);
const sub = (flow: string) => q<HTMLButtonElement>(`#flow-tabs [data-view="flow:${flow}"]`);
const shownViews = () => qa<HTMLElement>('.view').filter((v) => !v.hidden).map((v) => v.getAttribute('data-view'));
const selected = () => qa('.node.selected').map((g) => g.getAttribute('data-id'));
const alt = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, altKey: true }));
const count = () => q('#review-count').textContent;

describe('explain page with flows: tabs', () => {
  it('has a tab row, Components selected and showing, and no flow sub-tabs yet', async () => {
    mount(await draw());
    expect(qa('#view-tabs button').map((b) => b.textContent)).toEqual(['Components', 'Flows (2)']);
    expect(tab('components').getAttribute('aria-selected')).toBe('true');
    expect(shownViews()).toEqual(['components']);
    expect(q<HTMLElement>('#flow-tabs').hidden).toBe(true);
    expect(qa('#flow-tabs button').map((b) => b.textContent)).toEqual(['Create an invoice', 'Send the receipt']);
  });

  it('the Flows tab shows the first flow and its sub-tabs; the toolbar chips go away', async () => {
    mount(await draw());
    expect(q<HTMLElement>('#chips').hidden).toBe(false);
    click(tab('flows'));
    expect(shownViews()).toEqual(['flow:create']);
    expect(q<HTMLElement>('#flow-tabs').hidden).toBe(false);
    expect(sub('create').getAttribute('aria-selected')).toBe('true');
    expect(tab('flows').getAttribute('aria-selected')).toBe('true');
    expect(tab('components').getAttribute('aria-selected')).toBe('false');
    expect(q<HTMLElement>('#chips').hidden).toBe(true);
  });

  it('a sub-tab switches flows, and the Flows tab comes back to the one last open', async () => {
    mount(await draw());
    click(tab('flows'));
    click(sub('receipt'));
    expect(shownViews()).toEqual(['flow:receipt']);
    click(tab('components'));
    expect(shownViews()).toEqual(['components']);
    expect(q<HTMLElement>('#flow-tabs').hidden).toBe(true);
    expect(q<HTMLElement>('#chips').hidden).toBe(false);
    click(tab('flows'));
    expect(shownViews()).toEqual(['flow:receipt']);
  });

  it('a map without flows has no tab row and one plain canvas', async () => {
    const r = validateSpec(explain());
    if (!r.ok || r.spec.diagram === 'flow') throw new Error('fixture');
    mount(renderHtml(r.spec, await layoutSpec(r.spec), { generatedAt: new Date('2026-11-10T12:00:00Z'), repo: 'demo' }));
    expect(q('#view-bar')).toBeNull();
    expect(qa('.view')).toHaveLength(0);
    expect(q('style')!.textContent).not.toContain('.flowview');
  });

  it('step ids are namespaced, so a box and a step with the same id do not clash', async () => {
    const raw = withFlows();
    raw.flows[0].steps[0].id = 'billing';
    raw.flows[0].start = 'billing';
    raw.flows[0].links[0].from = 'billing';
    mount(await draw(raw));
    expect(qa('.node[data-id="billing"]')).toHaveLength(1);
    expect(qa('.node[data-id="flow:create/billing"]')).toHaveLength(1);
    expect(qa('template.card-panel[data-for="flow:create/billing"]')).toHaveLength(1);
  });

  it('the arrowheads are defined once, outside every view', async () => {
    mount(await draw());
    expect(qa('svg.defs marker').map((m) => m.id)).toEqual(expect.arrayContaining(['arrow', 'arrow-planned', 'arrow-added', 'arrow-removed']));
    expect(qa('.view marker')).toHaveLength(0);
  });
});

describe('explain page with flows: links between a box and its flows', () => {
  it('a box lists the flows through it; a click opens that flow with the first such step selected', async () => {
    mount(await draw());
    click(el('billing'));
    expect(qa('#panel h3').map((h) => h.textContent)).toContain('Flows through this box');
    expect(qa('#panel button[data-goto^="flow:"]').map((b) => [b.textContent, b.getAttribute('data-goto')])).toEqual([
      ['Create an invoice', 'flow:create/zero'],
      ['Send the receipt', 'flow:receipt/build'],
    ]);
    click(q('#panel button[data-goto="flow:receipt/build"]'));
    expect(shownViews()).toEqual(['flow:receipt']);
    expect(selected()).toEqual(['flow:receipt/build']);
    expect(q('#panel .ptitle').textContent).toBe('Build the receipt');
  });

  it('a box no flow goes through has no such list', async () => {
    mount(await draw());
    click(el('stripe'));
    expect(q('#panel').textContent).not.toContain('Flows through this box');
  });

  it('a step says which box it is part of; a click returns to Components with that box selected', async () => {
    mount(await draw());
    click(tab('flows'));
    click(el(STEP));
    expect(q('#panel .partof').textContent).toBe('Part of: BillingService');
    click(q('#panel .partof button'));
    expect(shownViews()).toEqual(['components']);
    expect(selected()).toEqual(['billing']);
    expect(q('#panel .ptitle').textContent).toContain('BillingService');
  });

  it('a step panel has no EXISTING tag, just its type; the step has no badge', async () => {
    mount(await draw());
    click(tab('flows'));
    click(el(STEP));
    expect(q('#panel .status').textContent?.trim()).toBe('decision');
    expect(q('#panel .tag')).toBeNull();
    expect(el(STEP).querySelector('.badge')).toBeNull();
  });

  it('a step in no box has no Part of line', async () => {
    mount(await draw());
    click(tab('flows'));
    click(el('flow:create/charge'));
    expect(q('#panel .partof')).toBeNull();
  });
});

describe('explain page with flows: only the view showing reacts', () => {
  it('switching view clears the selection and shows the page info', async () => {
    mount(await draw());
    click(el('billing'));
    click(tab('flows'));
    expect(selected()).toEqual([]);
    expect(q<HTMLElement>('#panel').hidden).toBe(true);
    expect(q<HTMLElement>('#page-info').hidden).toBe(false);
  });

  it('review progress and the Next key cover the view showing', async () => {
    mount(await draw());
    expect(count()).toBe('0/4 reviewed');
    key(']');
    expect(selected()).toEqual(['api']);
    click(tab('flows'));
    expect(count()).toBe('0/4 reviewed');
    key(']');
    expect(selected()).toEqual(['flow:create/receive']);
    click(sub('receipt'));
    expect(count()).toBe('0/2 reviewed');
    key(']');
    key(']');
    expect(selected()).toEqual(['flow:receipt/mail']);
    key(']');
    expect(selected()).toEqual(['flow:receipt/build']);
  });

  it('r ticks the selected step only, and the tick is kept under its namespaced id', async () => {
    mount(await draw());
    click(tab('flows'));
    click(el(STEP));
    key('r');
    expect(el(STEP).classList.contains('reviewed')).toBe(true);
    expect(qa('.node.reviewed')).toHaveLength(1);
    expect(count()).toBe('1/4 reviewed');
    expect(JSON.parse(localStorage.getItem('codechart.reviewed:demo')!)).toEqual([[STEP, '']]);
    click(tab('components'));
    expect(count()).toBe('0/4 reviewed');
  });

  it('clicking the tick on a step ticks it', async () => {
    mount(await draw());
    click(tab('flows'));
    click(el(STEP).querySelector('.tick')!);
    expect(el(STEP).classList.contains('reviewed')).toBe(true);
  });

  it('wheel-zooming one view leaves the others where they were', async () => {
    mount(await draw());
    const vp = (name: string) => q(`.view[data-view="${name}"] .viewport`).getAttribute('transform');
    const before = vp('flow:create');
    const wheel = new WheelEvent('wheel', { deltaY: -200, clientX: 10, clientY: 10, bubbles: true, cancelable: true });
    q('.view[data-view="components"] .canvas').dispatchEvent(wheel);
    expect(vp('flow:create')).toBe(before);
    expect(vp('components')).not.toBe(before);
  });
});

describe('explain page with flows: history and the URL', () => {
  it('names the view and the node in the hash, and Back crosses views', async () => {
    mount(await draw());
    click(el('billing'));
    expect(location.hash).toBe('#view=components&node=billing');
    click(tab('flows'));
    expect(location.hash).toBe('#view=flow%3Acreate&info');
    click(el(STEP));
    expect(location.hash).toBe('#view=flow%3Acreate&node=flow%3Acreate%2Fzero');
    alt('ArrowLeft');
    expect(location.hash).toBe('#view=flow%3Acreate&info');
  });

  it('Alt+← walks back from a flow to the box on Components, and Alt+→ forward again', async () => {
    mount(await draw());
    click(el('billing'));
    click(tab('flows'));
    alt('ArrowLeft');
    expect(shownViews()).toEqual(['components']);
    expect(selected()).toEqual(['billing']);
    alt('ArrowRight');
    expect(shownViews()).toEqual(['flow:create']);
  });

  it('restores a flow step from #view=…&node=…', async () => {
    mount(await draw(), true, '#view=flow%3Areceipt&node=flow%3Areceipt%2Fmail');
    expect(shownViews()).toEqual(['flow:receipt']);
    expect(selected()).toEqual(['flow:receipt/mail']);
    expect(sub('receipt').getAttribute('aria-selected')).toBe('true');
  });

  it('the Gaps button on a flow keeps the flow in the hash, and a reload restores the flow with the info', async () => {
    mount(await draw());
    click(tab('flows'));
    click(sub('receipt'));
    click(el('flow:receipt/mail'));
    click(q('#info-toggle'));
    expect(location.hash).toBe('#view=flow%3Areceipt&info');
    expect(q<HTMLElement>('#page-info').hidden).toBe(false);
    mount(await draw(), true, location.hash);
    expect(shownViews()).toEqual(['flow:receipt']);
    expect(q<HTMLElement>('#page-info').hidden).toBe(false);
    expect(selected()).toEqual([]);
  });

  it('the legacy #info opens the page info on Components', async () => {
    mount(await draw(), true, '#info');
    expect(shownViews()).toEqual(['components']);
    expect(q<HTMLElement>('#page-info').hidden).toBe(false);
  });

  it('the Gaps button on Components names Components in the hash', async () => {
    mount(await draw());
    click(el('billing'));
    click(q('#info-toggle'));
    expect(location.hash).toBe('#view=components&info');
  });

  it('restores a view with nothing selected from #view=…', async () => {
    mount(await draw(), true, '#view=flow%3Areceipt');
    expect(shownViews()).toEqual(['flow:receipt']);
    expect(selected()).toEqual([]);
  });

  it('still takes the old #node=<box> link, on Components', async () => {
    mount(await draw(), true, '#node=billing');
    expect(shownViews()).toEqual(['components']);
    expect(selected()).toEqual(['billing']);
  });

  it('a #node= link to a step opens its flow', async () => {
    mount(await draw(), true, '#node=flow%3Areceipt%2Fmail');
    expect(shownViews()).toEqual(['flow:receipt']);
    expect(selected()).toEqual(['flow:receipt/mail']);
  });

  it('a node that is not there falls back to its view, and an unknown view to the first', async () => {
    mount(await draw(), true, '#view=flow%3Areceipt&node=gone');
    expect(shownViews()).toEqual(['flow:receipt']);
    expect(selected()).toEqual([]);
    mount(await draw(), true, '#view=flow%3Anope');
    expect(shownViews()).toEqual(['components']);
  });
});

describe('explain page with flows: look and notes', () => {
  it('flow rules are scoped under the flow views, so a box keeps its own look', async () => {
    mount(await draw());
    const css = q('style').textContent!;
    expect(css).toContain('.flowview .node .shape{');
    expect(css).toContain('.flowview .node .label{font-weight:500;text-anchor:middle}');
    expect(css).not.toMatch(/(^|[}\n])\.node \.label\{font-weight:500/);
    expect(css).not.toMatch(/(^|[}\n])\.node \.shape\{/);
    expect(css).toContain('#arrow-planned path{fill:var(--cfg)}');
    // `#chips{display:flex}` would otherwise beat the hidden attribute
    expect(css).toContain('[data-only-view][hidden]{display:none!important}');
    expect(q('.view[data-view="components"]').classList.contains('flowview')).toBe(false);
    expect(qa('.view.flowview')).toHaveLength(2);
  });

  it("the flow's panel rules apply to step panels only, not to a box's panel", async () => {
    mount(await draw());
    const css = q('style').textContent!;
    expect(css).not.toMatch(/(^|[}\n])aside \.(status|tag|more|branches|planned-note|removed-note)/);
    expect(css).toContain('aside .steppanel .status{');
    click(el('billing'));
    expect(q('#panel .steppanel')).toBeNull();
    click(tab('flows'));
    click(el(STEP));
    expect(q('#panel .steppanel .status')).not.toBeNull();
    expect(q('#panel .steppanel .phead')).not.toBeNull();
  });

  it('the page info lists the map gaps and each flow gap led by the flow title', async () => {
    mount(await draw());
    expect(qa('#page-info [data-notes="gap"] li').map((li) => li.textContent)).toEqual(['refund job: not read', 'Create an invoice: retries: not read']);
  });

  it('a note on a step is put on its namespaced id and reads with the flow title', async () => {
    mount(await draw(withFlows(), true));
    click(q('#view-tabs [data-tab="flows"]'));
    click(el(STEP));
    click(q('#panel .cm-node-btn'));
    const ta = q<HTMLTextAreaElement>('.cm-composer textarea');
    ta.value = 'why zero?';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    click(q('.cm-save'));
    const saved = JSON.parse(localStorage.getItem(NOTES_KEY)!) as { t: unknown; b: string }[];
    expect(saved).toMatchObject([{ t: { node: STEP }, b: 'why zero?' }]);
    expect(el(STEP).querySelector('.cm-badge')).not.toBeNull();
    expect(qa('.cm-note').length).toBe(1);
  });
});

describe('explain page with flows: tab styling', () => {
  const css = () => q('style').textContent ?? '';

  it('main tabs are underlined text, flow sub-tabs are small pills on their own row', async () => {
    mount(await draw());
    const c = css();
    expect(c).toMatch(/#view-tabs button\[aria-selected="true"\]\{[^}]*border-bottom-color:var\(--edge\)/);
    expect(c).not.toMatch(/#view-tabs button[^{]*\{[^}]*border-radius:1\d/);
    expect(c).toMatch(/#flow-tabs\{[^}]*background:var\(--bg\)/);
    expect(c).toMatch(/#flow-tabs::before\{content:"Flow:"/);
    expect(c).toMatch(/#flow-tabs button\[aria-selected="true"\]\{[^}]*background:var\(--panel\)[^}]*border-color:var\(--line\)/);
  });

  it('keeps a visible keyboard focus on both tab rows', async () => {
    mount(await draw());
    expect(css()).toMatch(/#view-bar button:focus-visible\{outline:2px solid var\(--edge\)/);
  });
});
