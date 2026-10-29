// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"enableJavaScriptEvaluation":true}}
import { beforeEach, describe, expect, it } from 'vitest';
import { renderFlowHtml } from '../../src/render/flow/html.js';
import { layoutFlow } from '../../src/render/flow/layout.js';
import { sampleFlow, sampleSnippets } from './flow-fixture.js';

const spec = sampleFlow();
const snippets = sampleSnippets();
snippets.steps.get('read')!.lines = ['const t = "</template>";', '<script>alert(1)</script>', 'return t;'];
const page = renderFlowHtml(spec, await layoutFlow(spec), snippets, {
  generatedAt: new Date('2026-10-27T12:00:00Z'),
  repo: 'demo',
});

const q = <T extends Element>(sel: string) => document.querySelector(sel) as T;
const node = (id: string) => q<SVGGElement>(`.node[data-id="${id}"]`);
const panel = () => q<HTMLElement>('#panel');
const info = () => q<HTMLElement>('#page-info');
const toggle = () => q<HTMLElement>('#info-toggle');
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

beforeEach(() => {
  if (!('escape' in CSS)) {
    (CSS as { escape?: (s: string) => string }).escape = (s) => s.replace(/([^\w-])/g, '\\$1');
  }
  const parsed = new DOMParser().parseFromString(page, 'text/html');
  document.documentElement.setAttribute('data-theme', parsed.documentElement.getAttribute('data-theme')!);
  document.documentElement.replaceChildren(document.importNode(parsed.head, true), document.importNode(parsed.body, true));
  const scripts = [...document.querySelectorAll('script')].filter((s) => s.type !== 'application/json');
  expect(scripts).toHaveLength(1);
  const run = document.createElement('script');
  run.textContent = scripts[0]!.textContent;
  scripts[0]!.remove();
  document.body.appendChild(run);
});

describe('flow client', () => {
  it('starts on page-info with gaps', () => {
    expect(info().hidden).toBe(false);
    expect(panel().hidden).toBe(true);
    expect(info().textContent).toContain('did not check stdin TTY');
  });

  it('click a step shows status, source and snippet as text', () => {
    click(node('read'));
    expect(panel().hidden).toBe(false);
    expect(info().hidden).toBe(true);
    expect(node('read').classList.contains('selected')).toBe(true);
    expect(panel().querySelector('h2')?.textContent).toContain('read file or stdin');
    expect(panel().textContent).toContain('existing');
    expect(panel().textContent).toContain('src/render.ts:10-12');
    const code = panel().querySelector('.snippet')?.textContent ?? '';
    expect(code).toContain('const t = "</template>";');
    expect(code).toContain('<script>alert(1)</script>');
    expect(panel().querySelectorAll('script')).toHaveLength(0);
  });

  it('switches between steps and back to page-info', () => {
    click(node('read'));
    click(node('web'));
    expect(node('read').classList.contains('selected')).toBe(false);
    expect(node('web').classList.contains('selected')).toBe(true);
    expect(panel().textContent).toContain('planned');
    expect(panel().querySelector('.snippet')).toBeNull();
    click(toggle());
    expect(info().hidden).toBe(false);
    expect(panel().hidden).toBe(true);
    expect(document.querySelectorAll('.node.selected')).toHaveLength(0);
  });

  it('Enter on a decision shows its branches', () => {
    node('mode').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(panel().hidden).toBe(false);
    expect(panel().textContent).toContain('print terminal map');
    expect(panel().textContent).toContain('case "cli": print(map);');
  });
});
