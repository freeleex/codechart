// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderHtml } from '../../src/render/web/html.js';
import { layoutSpec } from '../../src/render/web/layout.js';
import { validateSpec, type Spec } from '../../src/spec/schema.js';
import { explain } from '../fixtures/explain.js';
import { click, mount, node, q, qa, usePages } from '../helpers/page.js';

usePages();

const spec = (raw: object): Spec => {
  const r = validateSpec(raw);
  if (!r.ok || r.spec.diagram === 'flow') throw new Error('fixture');
  return r.spec;
};
const draw = async (raw: object = explain()) => {
  const s = spec(raw);
  return renderHtml(s, await layoutSpec(s), { generatedAt: new Date('2026-11-10T12:00:00Z'), repo: 'demo' });
};
const chipTexts = () => qa<HTMLElement>('#chips .chip').map((c) => c.textContent);

describe('explain page', () => {
  it('existing boxes have no badge; outside boxes are dashed with an OUTSIDE badge', async () => {
    mount(await draw());
    expect(node('api').classList.contains('status-existing')).toBe(true);
    expect(node('api').querySelector('.badge')).toBeNull();
    expect(node('stripe').classList.contains('status-outside')).toBe(true);
    expect(node('stripe').querySelector('.badge')?.textContent).toBe('outside');
    expect(q('style').textContent).toMatch(/:is\(\.status-context,\.status-outside\) \.card\{stroke-dasharray:4 3\}/);
  });

  it('has an Outside chip only: no "Δ changes only", no existing chip', async () => {
    mount(await draw());
    expect(chipTexts()).toEqual(['○2 outside']);
    expect(q('.chip-delta')).toBeNull();
  });

  it('the Outside chip fades the outside boxes and their edges', async () => {
    mount(await draw());
    click(q('.chip[data-status="outside"]'));
    expect(qa('.node.faded').map((g) => g.getAttribute('data-id')).sort()).toEqual(['email', 'stripe']);
    expect(qa('.edge.faded')).toHaveLength(2);
  });

  it('a map with nothing outside has no chips', async () => {
    const raw = explain();
    raw.nodes = raw.nodes.slice(0, 2);
    raw.edges = raw.edges.slice(0, 1);
    mount(await draw(raw));
    expect(q('#chips')).toBeNull();
  });

  it('the panel says where the box stands in plain words, without change wording', async () => {
    mount(await draw());
    click(node('billing'));
    expect(q('#panel .ptitle').textContent).toBe('BillingService (service, in this area)');
    expect(q('#panel').textContent).toContain('A zero total skips the charge.');
    click(node('stripe'));
    expect(q('#panel .ptitle').textContent).toBe('Stripe API (outside this area)');
    expect(node('email').getAttribute('aria-label')).toBe('EmailService (service, outside this area)');
  });

  it('the page offers Gaps, not "Not on map", and no Now / After panes', async () => {
    mount(await draw());
    expect(q('#info-toggle').textContent).toBe('Gaps');
    expect(qa('.pane')).toHaveLength(0);
    expect(q('#page-info').textContent).toContain('refund job: not read');
  });

  it('a plan still gets its Δ chip and its status words', async () => {
    mount(
      await draw({ title: 'P', kind: 'plan', nodes: [{ id: 'a', label: 'a', kind: 'other', status: 'new', layer: 'l' }, { id: 'b', label: 'b', kind: 'other', status: 'context', layer: 'l' }], edges: [] }),
    );
    expect(chipTexts()).toEqual(['Δ changes only', '+1 new', '·1 context']);
    expect(node('a').querySelector('.badge')?.textContent).toBe('new');
  });
});
