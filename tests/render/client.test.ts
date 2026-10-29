// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { layoutSpec } from '../../src/render/web/layout.js';
import { renderHtml } from '../../src/render/web/html.js';
import { validateSpec } from '../../src/spec/schema.js';

const raw = JSON.parse(readFileSync('tests/fixtures/shop.spec.json', 'utf8'));
const validated = validateSpec(raw);
if (!validated.ok) throw new Error(validated.errors.join('\n'));
if (validated.spec.diagram === 'flow') throw new Error('expected map spec');
const spec = validated.spec;
const page = await renderHtml(spec, await layoutSpec(spec), {
  generatedAt: new Date('2026-10-27T12:00:00Z'),
  repo: 'demo',
});

const q = <T extends Element>(sel: string) => document.querySelector(sel) as T;
const node = (id: string) => q<SVGGElement>(`.node[data-id="${id}"]`);
const panel = () => q<HTMLElement>('#panel');
const info = () => q<HTMLElement>('#page-info');
const toggle = () => q<HTMLElement>('#info-toggle');

beforeEach(() => {
  if (!('escape' in CSS)) {
    (CSS as { escape?: (s: string) => string }).escape = (s) => s.replace(/([^\w-])/g, '\\$1');
  }
  document.documentElement.innerHTML = page.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
  const scripts = [...document.querySelectorAll('script')].filter((s) => s.type !== 'application/json');
  expect(scripts.length).toBeGreaterThan(0);
  for (const s of scripts) new Function(s.textContent ?? '')();
});

describe('client panel switching', () => {
  it('starts on page-info', () => {
    expect(info().hidden).toBe(false);
    expect(panel().hidden).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('click on a node shows its panel', () => {
    node('tbl.orders').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(panel().hidden).toBe(false);
    expect(info().hidden).toBe(true);
    expect(node('tbl.orders').classList.contains('selected')).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(panel().querySelector('h2')?.textContent).toContain('orders');
    const items = [...panel().querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toHaveLength(3);
    expect(items.some((t) => t?.includes('coupon_code') && t.includes('+'))).toBe(true);
    expect(items.some((t) => t?.includes('status') && t.includes('~'))).toBe(true);
    expect(panel().querySelector('.fields-note')?.textContent).toContain('defaults.context: full');
  });

  it('Enter on a node shows its panel', () => {
    node('tbl.orders').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(panel().hidden).toBe(false);
    expect(info().hidden).toBe(true);
    expect(node('tbl.orders').classList.contains('selected')).toBe(true);
  });

  it('info toggle returns to page-info and clears selection', () => {
    node('tbl.orders').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    toggle().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(info().hidden).toBe(false);
    expect(panel().hidden).toBe(true);
    expect(document.querySelectorAll('.node.selected')).toHaveLength(0);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('fieldsComplete node shows no note', () => {
    node('tbl.invoices').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(panel().hidden).toBe(false);
    expect(panel().querySelector('h2')?.textContent).toContain('invoices');
    expect(panel().querySelectorAll('li').length).toBeGreaterThan(0);
    expect(panel().querySelector('.fields-note')).toBeNull();
  });
});
