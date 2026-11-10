// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderHtml } from '../../src/render/web/html.js';
import { layoutSpec } from '../../src/render/web/layout.js';
import { validateSpec } from '../../src/spec/schema.js';
import { explain } from '../fixtures/explain.js';
import { explainFlowsPage, explainRepo } from '../helpers/explain-flows.js';
import { click, key, mount, q, qa, usePages } from '../helpers/page.js';

usePages();

let repo: string;
beforeAll(() => {
  repo = explainRepo();
});

const draw = () => explainFlowsPage(repo);
const STEP = 'flow:create/zero';
const el = (id: string) => q<SVGGElement>(`.node[data-id="${id}"]`);
const tab = (name: string) => q<HTMLButtonElement>(`#view-tabs [data-tab="${name}"]`);
const sub = (flow: string) => q<HTMLButtonElement>(`#flow-tabs [data-view="flow:${flow}"]`);
const view = (name: string) => q<HTMLElement>(`.view[data-view="${name}"]`);
const shownViews = () => qa<HTMLElement>('.view').filter((v) => !v.hidden).map((v) => v.getAttribute('data-view'));
const selected = () => qa('.node.selected').map((g) => g.getAttribute('data-id'));
const ids = (sel: string) => qa(sel).map((g) => g.getAttribute('data-id'));
const alt = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, altKey: true }));
const side = (on = true) => {
  const box = q<HTMLInputElement>('#sbs-toggle');
  box.checked = on;
  box.dispatchEvent(new Event('change', { bubbles: true }));
};
const transform = (name: string) => q(`.view[data-view="${name}"] .viewport`).getAttribute('transform');
const wheel = (name: string) => q(`.view[data-view="${name}"] .canvas`).dispatchEvent(new WheelEvent('wheel', { deltaY: -200, clientX: 10, clientY: 10, bubbles: true, cancelable: true }));

describe('side by side: the switch', () => {
  it('is a labelled switch at the right end of the tab row, off at first', async () => {
    mount(await draw());
    const box = q<HTMLInputElement>('#view-row #sbs-toggle');
    expect(box.type).toBe('checkbox');
    expect(box.getAttribute('role')).toBe('switch');
    expect(box.checked).toBe(false);
    expect(q('#sbs').textContent).toBe('Side by side');
    expect(q('#view-row').lastElementChild).toBe(q('#sbs'));
    expect(q('#view-tabs #sbs')).toBeNull();
    expect(document.body.classList.contains('sbs')).toBe(false);
  });

  it('is not on a map without flows', async () => {
    const r = validateSpec(explain());
    if (!r.ok || r.spec.diagram === 'flow') throw new Error('fixture');
    mount(renderHtml(r.spec, await layoutSpec(r.spec), { generatedAt: new Date('2026-11-10T12:00:00Z'), repo: 'demo' }));
    expect(q('#sbs-toggle')).toBeNull();
    expect(q('#viewpanes')).toBeNull();
  });

  it('has no inline handler, only the script the CSP allows', async () => {
    const html = await draw();
    expect(html).not.toMatch(/\son\w+=/i);
    expect(html.match(/<script(?![^>]*application\/json)/g)).toHaveLength(1);
  });

  it('shows Components and the first flow, each under its title, with the flow tabs and neither main tab selected', async () => {
    mount(await draw());
    side();
    expect(shownViews()).toEqual(['components', 'flow:create']);
    expect(document.body.classList.contains('sbs')).toBe(true);
    expect(view('components').querySelector('.pane-title')!.textContent).toBe('Components');
    expect(view('flow:create').querySelector('.pane-title')!.textContent).toBe('Create an invoice');
    expect(q<HTMLElement>('#flow-tabs').hidden).toBe(false);
    expect(sub('create').getAttribute('aria-selected')).toBe('true');
    expect(tab('components').getAttribute('aria-selected')).toBe('false');
    expect(tab('flows').getAttribute('aria-selected')).toBe('false');
    expect(q<HTMLElement>('#chips').hidden).toBe(false);
  });

  it('puts &sbs=1 in the URL and takes it out again', async () => {
    mount(await draw());
    click(el('billing'));
    side();
    expect(location.hash).toBe('#view=components&node=billing&sbs=1');
    click(el(STEP));
    expect(location.hash).toBe('#view=flow%3Acreate&node=flow%3Acreate%2Fzero&sbs=1');
    side(false);
    expect(location.hash).toBe('#view=flow%3Acreate&node=flow%3Acreate%2Fzero');
  });

  it('a reload restores it, with the flow and step the URL names', async () => {
    mount(await draw());
    side();
    click(sub('receipt'));
    click(el('flow:receipt/mail'));
    const hash = location.hash;
    expect(hash).toContain('sbs=1');
    mount(await draw(), false, hash);
    expect(shownViews()).toEqual(['components', 'flow:receipt']);
    expect(q<HTMLInputElement>('#sbs-toggle').checked).toBe(true);
    expect(selected()).toEqual(['flow:receipt/mail']);
    expect(ids('.node.linked')).toEqual(['email']);
    expect(location.hash).toBe(hash);
  });

  it('is off after a reload without it in the URL', async () => {
    mount(await draw(), true, '#view=components&info');
    expect(shownViews()).toEqual(['components']);
    expect(q<HTMLInputElement>('#sbs-toggle').checked).toBe(false);
  });

  it('turning it off keeps the tab last active: Flows after a step, Components after a box', async () => {
    mount(await draw());
    side();
    click(el(STEP));
    side(false);
    expect(shownViews()).toEqual(['flow:create']);
    expect(tab('flows').getAttribute('aria-selected')).toBe('true');
    expect(q<HTMLElement>('#chips').hidden).toBe(true);
    side();
    click(el('billing'));
    side(false);
    expect(shownViews()).toEqual(['components']);
    expect(tab('components').getAttribute('aria-selected')).toBe('true');
    expect(q<HTMLElement>('#flow-tabs').hidden).toBe(true);
    expect(document.body.classList.contains('sbs')).toBe(false);
  });

  it('a main tab ends it and shows its own view', async () => {
    mount(await draw());
    side();
    click(tab('components'));
    expect(shownViews()).toEqual(['components']);
    expect(q<HTMLInputElement>('#sbs-toggle').checked).toBe(false);
    expect(location.hash).not.toContain('sbs');
    side();
    click(tab('flows'));
    expect(shownViews()).toEqual(['flow:create']);
    expect(q<HTMLInputElement>('#sbs-toggle').checked).toBe(false);
  });

  it('a flow sub-tab changes the flow on the right and keeps Components', async () => {
    mount(await draw());
    side();
    click(sub('receipt'));
    expect(shownViews()).toEqual(['components', 'flow:receipt']);
    expect(sub('receipt').getAttribute('aria-selected')).toBe('true');
    expect(location.hash).toContain('sbs=1');
  });

  it('keeps the flow chosen when Components is visited again', async () => {
    mount(await draw());
    side();
    click(sub('receipt'));
    click(el('billing'));
    expect(shownViews()).toEqual(['components', 'flow:receipt']);
  });
});

describe('side by side: a click lights what it is linked to in the other pane', () => {
  it('a step lights its box in the selected look and dims the other boxes; the step is the selection', async () => {
    mount(await draw());
    side();
    click(el(STEP));
    expect(selected()).toEqual([STEP]);
    expect(ids('.node.linked')).toEqual(['billing']);
    expect(ids('.view[data-view="components"] .node.lit')).toEqual(['billing']);
    expect(view('components').classList.contains('pane-dim')).toBe(true);
    expect(view('flow:create').classList.contains('pane-dim')).toBe(true);
    expect(document.body.classList.contains('focus')).toBe(false);
    expect(q('#panel .partof').textContent).toBe('Part of: BillingService');
  });

  it('a box lights every step of the flow showing that happens in it, and nothing in another flow', async () => {
    mount(await draw());
    side();
    click(el('billing'));
    expect(selected()).toEqual(['billing']);
    expect(ids('.node.linked').sort()).toEqual(['flow:create/skip', 'flow:create/zero']);
    expect(ids('.view[data-view="flow:create"] .node.lit').sort()).toEqual(['flow:create/skip', 'flow:create/zero']);
    expect(qa('.view[data-view="flow:receipt"] .node.lit')).toHaveLength(0);
    expect(view('flow:create').classList.contains('pane-dim')).toBe(true);
    expect(view('components').classList.contains('pane-dim')).toBe(true);
  });

  it('the box lights the steps of the other flow once that flow is on the right', async () => {
    mount(await draw());
    side();
    click(sub('receipt'));
    click(el('billing'));
    expect(ids('.node.linked')).toEqual(['flow:receipt/build']);
    click(el('stripe'));
    expect(qa('.node.linked')).toHaveLength(0);
    expect(view('flow:receipt').classList.contains('pane-dim')).toBe(true);
  });

  it('a step in no box lights no box and leaves the boxes clear', async () => {
    mount(await draw());
    side();
    click(el('flow:create/charge'));
    expect(selected()).toEqual(['flow:create/charge']);
    expect(qa('.node.linked')).toHaveLength(0);
    expect(qa('.view[data-view="components"] .node.lit')).toHaveLength(0);
    expect(view('components').classList.contains('pane-dim')).toBe(false);
    expect(view('flow:create').classList.contains('pane-dim')).toBe(true);
  });

  it('a click elsewhere replaces the highlight, not adds to it', async () => {
    mount(await draw());
    side();
    click(el(STEP));
    click(el('flow:create/receive'));
    expect(ids('.node.linked')).toEqual(['api']);
  });

  it('Escape lights everything again and keeps the selection and the panel', async () => {
    mount(await draw());
    side();
    click(el(STEP));
    key('Escape');
    expect(qa('.node.lit, .node.linked, .pane-dim')).toHaveLength(0);
    expect(selected()).toEqual([STEP]);
    expect(q<HTMLElement>('#panel').hidden).toBe(false);
    click(el('billing'));
    click(q('.view[data-view="components"] .canvas'));
    expect(qa('.node.lit, .node.linked, .pane-dim')).toHaveLength(0);
  });

  it('with it off, a step lights no box and the whole page dims as before', async () => {
    mount(await draw());
    click(tab('flows'));
    click(el(STEP));
    expect(qa('.node.linked')).toHaveLength(0);
    expect(document.body.classList.contains('focus')).toBe(true);
    expect(qa('.pane-dim')).toHaveLength(0);
  });

  it('turning it on with a step lit draws the link, and turning it off takes it back', async () => {
    mount(await draw());
    click(tab('flows'));
    click(el(STEP));
    side();
    expect(ids('.node.linked')).toEqual(['billing']);
    expect(document.body.classList.contains('focus')).toBe(false);
    side(false);
    expect(qa('.node.linked, .pane-dim')).toHaveLength(0);
    expect(document.body.classList.contains('focus')).toBe(true);
  });

  it('turning it on after Escape does not bring the highlight back', async () => {
    mount(await draw());
    click(tab('flows'));
    click(el(STEP));
    key('Escape');
    side();
    expect(qa('.node.lit, .node.linked, .pane-dim')).toHaveLength(0);
  });

  it('the Go to links in a panel keep both panes: a step goes to its box, a box to its flow', async () => {
    mount(await draw());
    side();
    click(el(STEP));
    click(q('#panel .partof button'));
    expect(shownViews()).toEqual(['components', 'flow:create']);
    expect(selected()).toEqual(['billing']);
    expect(ids('.node.linked').sort()).toEqual(['flow:create/skip', 'flow:create/zero']);
    click(q('#panel button[data-goto="flow:receipt/build"]'));
    expect(shownViews()).toEqual(['components', 'flow:receipt']);
    expect(selected()).toEqual(['flow:receipt/build']);
    expect(ids('.node.linked')).toEqual(['billing']);
  });

  it('the linked look is drawn like a selection', async () => {
    mount(await draw());
    const css = q('style').textContent!;
    expect(css).toContain('.node.linked :is(.card,.shape){stroke-width:3}');
    expect(css).toMatch(/\.pane-dim \.node:not\(\.lit\),\.pane-dim \.edge:not\(\.lit\)\{--dim:\.25\}/);
  });
});

describe('side by side: a box with no steps in the flow showing', () => {
  const note = () => q('.view[data-view="flow:create"] .pane-title .pane-note');

  it('dims the whole flow and says where the steps are, with a link to that flow', async () => {
    mount(await draw());
    side();
    click(el('email'));
    expect(note().textContent).toBe('No steps in EmailService · in: Send the receipt');
    expect([...note().querySelectorAll('button')].map((b) => b.getAttribute('data-flow'))).toEqual(['flow:receipt']);
    expect(view('flow:create').classList.contains('pane-dim')).toBe(true);
    expect(qa('.view[data-view="flow:create"] .node.lit')).toHaveLength(0);
    expect(qa('.node.linked')).toHaveLength(0);
  });

  it('the link takes the right pane to that flow and lights the box steps there', async () => {
    mount(await draw());
    side();
    click(el('email'));
    click(q('.pane-note button'));
    expect(shownViews()).toEqual(['components', 'flow:receipt']);
    expect(selected()).toEqual(['email']);
    expect(ids('.node.linked')).toEqual(['flow:receipt/mail']);
    expect(qa('.pane-note')).toHaveLength(0);
  });

  it('lists every flow that has steps in the box', async () => {
    mount(await draw());
    side();
    click(sub('receipt'));
    click(el('api'));
    expect(q('.view[data-view="flow:receipt"] .pane-note').textContent).toBe('No steps in POST /invoices · in: Create an invoice');
  });

  it('says so when no flow has steps in it', async () => {
    mount(await draw());
    side();
    click(el('stripe'));
    expect(note().textContent).toBe('No steps in Stripe API in any flow');
    expect(note().querySelector('button')).toBeNull();
    expect(view('flow:create').classList.contains('pane-dim')).toBe(true);
  });

  it('clears on Escape, on another selection and when side by side goes off', async () => {
    mount(await draw());
    side();
    click(el('email'));
    key('Escape');
    expect(qa('.pane-note, .pane-dim')).toHaveLength(0);
    click(el('email'));
    click(el('billing'));
    expect(qa('.pane-note')).toHaveLength(0);
    click(el('email'));
    click(el(STEP));
    expect(qa('.pane-note')).toHaveLength(0);
    click(el('stripe'));
    side(false);
    expect(qa('.pane-note, .pane-dim')).toHaveLength(0);
  });

  it('a box with steps in the flow, and a step, show no note', async () => {
    mount(await draw());
    side();
    click(el('billing'));
    click(el('flow:create/charge'));
    expect(qa('.pane-note')).toHaveLength(0);
  });

  it('the links are buttons and styled for the keyboard', async () => {
    mount(await draw());
    side();
    click(el('email'));
    expect(q('.pane-note button').tagName).toBe('BUTTON');
    expect(q('style').textContent).toContain('.pane-note button:focus-visible{outline:2px solid var(--edge)');
  });
});

describe('side by side: panes, keys and history', () => {
  it('each pane keeps its own pan and zoom', async () => {
    mount(await draw());
    side();
    const flow = transform('flow:create');
    const boxes = transform('components');
    wheel('components');
    expect(transform('components')).not.toBe(boxes);
    expect(transform('flow:create')).toBe(flow);
    const zoomed = transform('components');
    wheel('flow:create');
    expect(transform('flow:create')).not.toBe(flow);
    expect(transform('components')).toBe(zoomed);
  });

  it('the pane a flow was in keeps its zoom when the flow comes back', async () => {
    mount(await draw());
    side();
    wheel('flow:create');
    const zoomed = transform('flow:create');
    click(sub('receipt'));
    click(sub('create'));
    expect(transform('flow:create')).toBe(zoomed);
  });

  it('counts the boxes and the steps of the flow showing, and ] walks both panes in turn', async () => {
    mount(await draw());
    expect(q('#review-count').textContent).toBe('0/4 reviewed');
    side();
    expect(q('#review-count').textContent).toBe('0/8 reviewed');
    const order: (string | null | undefined)[] = [];
    for (let i = 0; i < 8; i++) {
      key(']');
      order.push(selected()[0]);
    }
    expect(order).toEqual(['api', 'billing', 'email', 'stripe', 'flow:create/receive', STEP, 'flow:create/skip', 'flow:create/charge']);
    click(sub('receipt'));
    expect(q('#review-count').textContent).toBe('0/6 reviewed');
    side(false);
    click(tab('components'));
    expect(q('#review-count').textContent).toBe('0/4 reviewed');
  });

  it('r ticks the selected item in either pane', async () => {
    mount(await draw());
    side();
    click(el(STEP));
    key('r');
    expect(el(STEP).classList.contains('reviewed')).toBe(true);
    expect(el('billing').classList.contains('reviewed')).toBe(false);
    click(el('billing'));
    key('r');
    expect(q('#review-count').textContent).toBe('2/8 reviewed');
  });

  it('Alt+← and Alt+→ walk the visits across both panes, and the mode stays in the URL', async () => {
    mount(await draw());
    side();
    click(el('billing'));
    click(el(STEP));
    alt('ArrowLeft');
    expect(selected()).toEqual(['billing']);
    expect(shownViews()).toEqual(['components', 'flow:create']);
    expect(location.hash).toBe('#view=components&node=billing&sbs=1');
    alt('ArrowRight');
    expect(selected()).toEqual([STEP]);
    expect(location.hash).toBe('#view=flow%3Acreate&node=flow%3Acreate%2Fzero&sbs=1');
  });

  describe('a zoom glide running when the switch changes', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('is stopped, so the panes keep the fresh fit', async () => {
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
      Object.defineProperty(window, 'requestAnimationFrame', { value: globalThis.requestAnimationFrame, configurable: true });
      const rect = { left: 0, top: 0, right: 800, bottom: 600, x: 0, y: 0, width: 800, height: 600 } as DOMRect;
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect);
      (SVGElement.prototype as unknown as { getBBox: () => unknown }).getBBox = () => ({ x: 0, y: 0, width: 100, height: 50 });
      mount(await draw());
      const fitted = transform('components');
      click(el('billing'));
      key('f');
      expect(frames).toHaveLength(1);
      side();
      const fresh = transform('components');
      const t = performance.now() + 1000;
      while (frames.length) frames.shift()!(t);
      expect(transform('components')).toBe(fresh);
      expect(fresh).toBe(fitted);
      vi.restoreAllMocks();
    });
  });

  it('Gaps shows the page info with both panes still up', async () => {
    mount(await draw());
    side();
    click(el(STEP));
    click(q('#info-toggle'));
    expect(shownViews()).toEqual(['components', 'flow:create']);
    expect(q<HTMLElement>('#page-info').hidden).toBe(false);
    expect(qa('.node.linked, .pane-dim')).toHaveLength(0);
  });
});

describe('side by side: layout', () => {
  const css = () => q('style').textContent!;

  it('the views sit in one row, each under a title shown only with it on', async () => {
    mount(await draw());
    expect(css()).toContain('#viewpanes{flex:1;min-width:0;display:flex}');
    expect(css()).toContain('.view>.pane-title{display:none}body.sbs .view>.pane-title{display:block}');
    expect(css()).toContain('body.sbs .view.flowview{border-left:1px solid var(--line)}');
    expect(q('#viewpanes')!.children).toHaveLength(3);
  });

  it('under 900px they stack, as Now and After do', async () => {
    mount(await draw());
    expect(css()).toContain('@media (max-width:900px){body.sbs #viewpanes{flex-direction:column}body.sbs .view.flowview{border-left:0;border-top:1px solid var(--line)}}');
  });

  it('the switch is a track and a knob, with a visible keyboard focus', async () => {
    mount(await draw());
    expect(css()).toMatch(/#sbs input\{appearance:none;/);
    expect(css()).toContain('#sbs input:checked{background:var(--edge)}');
    expect(css()).toContain('#sbs input:focus-visible{outline:2px solid var(--edge)');
  });
});
