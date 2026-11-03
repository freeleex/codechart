// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderFlow } from '../../src/commands/render-flow.js';
import { renderFlowHtml } from '../../src/render/flow/html.js';
import { layoutFlow } from '../../src/render/flow/layout.js';
import { hasFlowNowAfter } from '../../src/render/flow/states.js';
import { renderFlowTree } from '../../src/render/flow/tree.js';
import { validateSpec } from '../../src/spec/schema.js';
import type { FlowSpec } from '../../src/spec/flow.js';
import { sampleFlow } from './flow-fixture.js';

const src = 'api/invites.py';
const raw = {
  kind: 'plan',
  title: 'Reject revoked invites',
  start: 'lookup',
  steps: [
    { id: 'lookup', label: 'look up invite', status: 'existing', source: `${src}:1` },
    { id: 'expired', label: 'expired?', status: 'existing', source: `${src}:2` },
    { id: '410', label: '410 invite expired', status: 'existing', source: `${src}:3` },
    { id: 'revoked', label: 'revoked?', status: 'planned' },
    { id: '403', label: '403 invite revoked', status: 'planned' },
    { id: 'member', label: 'check membership', status: 'existing', source: `${src}:5` },
    { id: 'audit', label: 'log legacy audit', status: 'removed', source: `${src}:6` },
    { id: 'join', label: 'save membership', status: 'planned', source: `${src}:7` },
  ],
  links: [
    { from: 'lookup', to: 'expired' },
    { from: 'expired', to: '410', label: 'yes', source: `${src}:3` },
    { from: 'expired', to: 'member', label: 'no', source: `${src}:4`, removed: true },
    { from: 'expired', to: 'revoked', label: 'no' },
    { from: 'revoked', to: '403', label: 'yes' },
    { from: 'revoked', to: 'member', label: 'no' },
    { from: 'member', to: 'audit' },
    { from: 'audit', to: 'join' },
    { from: 'member', to: 'join', planned: true },
  ],
};

function load(input: unknown = raw): FlowSpec {
  const r = validateSpec(structuredClone(input));
  if (!r.ok) throw new Error(r.errors.join('\n'));
  if (r.spec.diagram !== 'flow') throw new Error('expected flow spec');
  return r.spec;
}

const errorsOf = (input: unknown) => {
  const r = validateSpec(input);
  if (r.ok) throw new Error('expected validation failure');
  return r.errors;
};

const spec = load();
const meta = { generatedAt: new Date('2026-11-03T12:00:00Z'), repo: 'demo' };
const noSnippets = { steps: new Map(), links: {} };

describe('plan flow with removals', () => {
  it('validates, and shapes follow the flow after the plan', () => {
    const byId = new Map(spec.steps.map((s) => [s.id, s.type]));
    expect(byId.get('member')).toBe('step');
    expect(byId.get('expired')).toBe('decision');
  });

  it('two panes only when the plan removes or alters something', () => {
    expect(hasFlowNowAfter(spec)).toBe(true);
    expect(hasFlowNowAfter(sampleFlow())).toBe(false);
  });

  it('rejects removed in a summary, removed + planned, a removed start and impossible links', () => {
    const summary = { ...raw, kind: 'summary', steps: raw.steps.map((s) => ({ ...s, status: s.status === 'planned' ? 'new' : s.status, source: s.source ?? `${src}:9` })) };
    expect(errorsOf(summary)).toContain('steps[6].status: a summary describes code that exists; "removed" is for plans');
    expect(errorsOf(summary)).toContain('links[2].removed: a summary describes code that exists; "removed" is for plans');

    const both = structuredClone(raw);
    Object.assign(both.links[2]!, { planned: true });
    expect(errorsOf(both)).toContain('links[2].removed: a link is either planned or removed, not both');

    expect(errorsOf({ ...raw, start: 'audit' })).toContain('start: the start step cannot be removed; start where the flow begins after the plan');

    const toNew = structuredClone(raw);
    toNew.links.push({ from: 'audit', to: '403' } as (typeof toNew.links)[number]);
    expect(errorsOf(toNew).some((e) => e.endsWith('they never exist at the same time'))).toBe(true);

    const plannedToRemoved = structuredClone(raw);
    Object.assign(plannedToRemoved.links[6]!, { planned: true });
    expect(errorsOf(plannedToRemoved)).toContain('links[6].planned: a link to a removed step cannot be planned');
  });
});

describe('plan flow Now and After HTML', async () => {
  const page = renderFlowHtml(spec, await layoutFlow(spec), noSnippets, meta);
  document.documentElement.innerHTML = page.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
  const panes = [...document.querySelectorAll('.pane')];
  const ids = (pane: Element) => [...pane.querySelectorAll('.node')].map((g) => g.getAttribute('data-id'));

  it('Now shows today: altered and removed steps, no brand-new ones', () => {
    expect(panes.map((p) => p.querySelector('.pane-title')?.firstChild?.textContent)).toEqual(['Now', 'After plan']);
    expect(ids(panes[0]!)).toEqual(['lookup', 'expired', '410', 'member', 'audit', 'join']);
    expect(ids(panes[1]!)).toEqual(['lookup', 'expired', '410', 'revoked', '403', 'member', 'join']);
  });

  it('Now draws the links the plan drops in red and leaves out the ones it adds', () => {
    expect(panes[0]!.querySelectorAll('.edge')).toHaveLength(5);
    expect(panes[0]!.querySelectorAll('.edge-removed')).toHaveLength(3);
    expect(panes[0]!.querySelectorAll('.edge.planned')).toHaveLength(0);
    expect(panes[0]!.querySelector('.edge-removed path')!.getAttribute('marker-end')).toBe('url(#arrow-removed)');
  });

  it('After drops removed links and shows planned ones dashed', () => {
    expect(panes[1]!.querySelectorAll('.edge')).toHaveLength(6);
    expect(panes[1]!.querySelectorAll('.edge-removed')).toHaveLength(0);
    expect(panes[1]!.querySelectorAll('.edge.planned')).toHaveLength(4);
  });

  it('an altered step is amber in Now and planned in After', () => {
    const join = (pane: Element) => pane.querySelector('.node[data-id="join"]')!;
    expect(join(panes[0]!).getAttribute('class')).toContain('status-changed');
    expect(join(panes[0]!).querySelector('.badge')?.textContent).toBe('will change');
    expect(join(panes[1]!).getAttribute('class')).toContain('status-planned');
  });

  it('pane keys say what each colour means', () => {
    expect(panes.map((p) => p.querySelector('.pane-key')?.textContent)).toEqual([
      ' · red: removed by the plan · amber: changed by it',
      ' · dashed: planned',
    ]);
  });

  it('the step panel says a removed step goes and tags removed links', () => {
    const tpl = (id: string) => document.querySelector<HTMLTemplateElement>(`template[data-for="${id}"]`)!.innerHTML;
    expect(tpl('audit')).toContain('Removed by the plan.');
    expect(tpl('expired')).toContain('tag-removed');
  });
});

describe('plan flow terminal', () => {
  const opts = { maxNodes: 20, width: 100, color: false };

  it('marks removed steps and links with - and adds it to the key', () => {
    const text = renderFlowTree(spec, opts).text;
    expect(text).toContain('-no');
    expect(text).toContain('-log legacy audit');
    expect(text).toContain('? planned  - removed');
    expect(text).toContain('1 removed');
  });

  it('flows without removals keep the old key', () => {
    expect(renderFlowTree(sampleFlow(), opts).text).not.toContain('- removed');
  });

  it('auto writes the HTML for a Now/After plan', async () => {
    let written = 0;
    const out = await renderFlow(spec, noSnippets, {
      output: 'auto',
      minNodes: 50,
      tree: opts,
      writeHtml: async (build) => {
        written++;
        await build(meta);
        return '/tmp/x.flow.html';
      },
    });
    expect(written).toBe(1);
    expect(out).toContain('full map → file:///tmp/x.flow.html');
  });
});
