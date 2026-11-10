import { describe, expect, it } from 'vitest';
import { renderTerminal } from '../../src/render/terminal/render.js';
import { validateSpec, type Spec } from '../../src/spec/schema.js';
import { explain } from '../fixtures/explain.js';

const spec = (raw: object): Spec => {
  const r = validateSpec(raw);
  if (!r.ok || r.spec.diagram === 'flow') throw new Error('fixture');
  return r.spec;
};
const draw = (raw: object, color = false) => renderTerminal(spec(raw), { maxNodes: 40, color, width: 80, check: { checked: 3, mismatches: [], unit: 'node' } });

describe('explain map in the terminal', () => {
  it('marks outside boxes with ○, leaves existing ones unmarked, and counts boxes', () => {
    const text = draw(explain());
    expect(text).toContain('○ service EmailService');
    expect(text).toContain('○ Stripe API');
    expect(text).not.toMatch(/^[+~◆-] /m);
    expect(text).toContain('4 boxes · 2 outside · ✓ 3 checked');
    expect(text).toContain('key: ○ outside · unmarked = in this area');
    expect(text).not.toMatch(/\bnew\b|\bchanged\b|\bconfig\b|unchanged/);
  });

  it('keeps an outside box reached only through another outside box', () => {
    const raw = explain();
    raw.nodes.push({ id: 'smtp', label: 'SMTP relay', kind: 'other', status: 'outside', layer: 'other areas' });
    raw.edges.push({ from: 'email', to: 'smtp', label: 'sends', kind: 'calls' });
    const text = draw(raw);
    expect(text).toContain('○ SMTP relay');
    expect(text).toContain('─sends─▶ SMTP relay');
  });

  it('leaves the outside count out when nothing is outside', () => {
    const raw = explain();
    raw.nodes = raw.nodes.slice(0, 2);
    raw.edges = raw.edges.slice(0, 1);
    expect(draw(raw)).toContain('2 boxes · ✓ 3 checked');
  });

  it('shows the fields of an existing box when there is no page, plain: no change marks', () => {
    const raw = explain();
    raw.nodes[1].fieldsComplete = true;
    raw.nodes[1].fields = [{ name: 'total', type: 'int' }];
    expect(draw(raw)).toContain('    total int');
  });

  it('colours: outside dim, existing plain', () => {
    const text = draw(explain(), true);
    expect(text).toContain('\u001b[2m○ service EmailService');
    expect(text).toMatch(/\n {2}endpoint POST \/invoices/);
  });

  it('a plan keeps its own key and counts', () => {
    const text = draw({ title: 'P', kind: 'plan', nodes: [{ id: 'a', label: 'a', kind: 'other', status: 'new', layer: 'l' }], edges: [] });
    expect(text).toContain('1 nodes · 1 new · 0 changed · 0 config');
    expect(text).toContain('unmarked = unchanged');
  });
});
