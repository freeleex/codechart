// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { click, flowPage, mount, panesPage, q, qa, shopPage, usePages } from '../helpers/page.js';

usePages();

const chip = (status: string) => q<HTMLElement>(`.chip[data-status="${status}"]`);
const delta = () => q<HTMLElement>('.chip-delta');
const pressed = (el: Element) => el.getAttribute('aria-pressed');
const fadedIds = () => qa<Element>('.node.faded').map((g) => g.getAttribute('data-id')).sort();
const withStatus = (status: string) => qa<Element>(`.node[data-status="${status}"]`).map((g) => g.getAttribute('data-id')).sort();
const chipTexts = () => qa<HTMLElement>('#chips .chip').map((c) => c.textContent);

describe('status chips', () => {
  it('a single map gets a chip per status present with its count, "Δ changes only" first', () => {
    mount(shopPage);
    expect(chipTexts()).toEqual(['Δ changes only', '+4 new', '~5 changed', '◆2 config', '·1 context']);
  });

  it('a Now / After plan adds removed, flows use their own statuses', () => {
    mount(panesPage);
    expect(chipTexts()).toEqual(['Δ changes only', '+1 new', '~2 changed', '−1 removed', '◆1 config', '·1 context']);
    mount(flowPage);
    expect(chipTexts()).toEqual(['Δ changes only', '○2 planned', '·3 existing']);
  });

  it('fade and focus dim multiply instead of replacing each other', () => {
    expect(shopPage).toContain('opacity:calc(var(--base,1)*var(--fade,1)*var(--dim,1))');
  });

  it('chips and review progress share one slim row under the header, for the whole page', () => {
    for (const html of [shopPage, panesPage, flowPage]) {
      mount(html);
      const row = qa('#toolbar');
      expect(row).toHaveLength(1);
      expect(row[0]!.previousElementSibling?.tagName).toBe('HEADER');
      expect(row[0]!.nextElementSibling?.tagName).toBe('MAIN');
      expect(row[0]!.querySelector('#chips .chip')).not.toBeNull();
      expect(row[0]!.querySelector('#review-count')).not.toBeNull();
      expect(q('header #chips, header #review')).toBeNull();
    }
    expect(qa('#chips')).toHaveLength(1);
  });

  it('chips carry the status colour class', () => {
    mount(shopPage);
    expect(chip('new').className).toContain('chip-new');
    expect(chip('config').className).toContain('chip-config');
  });

  it('a click fades that status, a second click brings it back', () => {
    mount(shopPage);
    expect(pressed(chip('config'))).toBe('false');
    click(chip('config'));
    expect(pressed(chip('config'))).toBe('true');
    expect(fadedIds()).toEqual(withStatus('config'));
    expect(fadedIds()).toHaveLength(2);
    click(chip('config'));
    expect(pressed(chip('config'))).toBe('false');
    expect(fadedIds()).toEqual([]);
  });

  it('an edge fades when either end is faded', () => {
    mount(shopPage);
    click(chip('context'));
    const faded = qa<Element>('.edge.faded');
    expect(faded.length).toBeGreaterThan(0);
    for (const e of faded) expect([e.getAttribute('data-from'), e.getAttribute('data-to')]).toContain('tbl.customers');
    expect(qa('.edge:not(.faded)').length).toBeGreaterThan(0);
    click(chip('context'));
    expect(qa('.edge.faded')).toHaveLength(0);
  });

  it('"Δ changes only" fades context and shows pressed only while context is the only faded status', () => {
    mount(shopPage);
    click(delta());
    expect(fadedIds()).toEqual(withStatus('context'));
    expect(pressed(delta())).toBe('true');
    expect(pressed(chip('context'))).toBe('true');
    click(chip('config'));
    expect(pressed(delta())).toBe('false');
    click(chip('config'));
    expect(pressed(delta())).toBe('true');
    click(delta());
    expect(fadedIds()).toEqual([]);
    expect(pressed(delta())).toBe('false');
  });

  it('"Δ changes only" not pressed fades exactly context, un-fading the rest; pressed it clears every fade', () => {
    mount(shopPage);
    click(chip('new'));
    click(chip('config'));
    click(delta());
    expect(fadedIds()).toEqual(withStatus('context'));
    expect(pressed(chip('new'))).toBe('false');
    expect(pressed(chip('config'))).toBe('false');
    expect(pressed(delta())).toBe('true');
    click(chip('new'));
    click(delta());
    expect(fadedIds()).toEqual(withStatus('context'));
    click(delta());
    expect(fadedIds()).toEqual([]);
    expect(JSON.parse(localStorage.getItem('codechart.faded')!)).toEqual([]);
  });

  it('flows fade their unchanged steps with the same chip', () => {
    mount(flowPage);
    click(delta());
    expect(fadedIds()).toEqual(withStatus('existing'));
    expect(fadedIds()).toEqual(['mode', 'print', 'read']);
  });

  it('fades the node in both panes', () => {
    mount(panesPage);
    click(chip('new'));
    const panes = qa<Element>('.canvas');
    expect(panes[1]!.querySelectorAll('.node.faded')).toHaveLength(1);
    expect(panes[0]!.querySelectorAll('.node.faded')).toHaveLength(0);
    click(chip('removed'));
    expect(panes[0]!.querySelectorAll('.node.faded')).toHaveLength(1);
  });

  it('is remembered across a reload', () => {
    mount(shopPage);
    click(chip('changed'));
    click(chip('config'));
    mount(shopPage, false);
    expect(fadedIds()).toEqual([...withStatus('changed'), ...withStatus('config')].sort());
    expect(pressed(chip('changed'))).toBe('true');
    expect(pressed(delta())).toBe('false');
  });

  it('forgets a saved status the page has no chip for, and bad data', () => {
    mount(shopPage);
    localStorage.setItem('codechart.faded', JSON.stringify(['removed', 'config']));
    mount(shopPage, false);
    expect(fadedIds()).toEqual(withStatus('config'));
    localStorage.setItem('codechart.faded', '{nope');
    mount(shopPage, false);
    expect(fadedIds()).toEqual([]);
  });
});
