import { describe, expect, it } from 'vitest';
import { compareFlows } from '../../src/render/flow/drift.js';
import { renderFlowHtml, withGhosts as withGhostSteps } from '../../src/render/flow/html.js';
import { layoutFlow } from '../../src/render/flow/layout.js';
import { compareMaps } from '../../src/render/map-drift.js';
import { ghostsFor, sentence } from '../../src/render/web/drift-html.js';
import type { DriftItem } from '../../src/render/drift.js';
import { renderHtml, withGhosts } from '../../src/render/web/html.js';
import { layoutSpec } from '../../src/render/web/layout.js';
import type { FlowSpec, FlowStep } from '../../src/spec/flow.js';
import type { Spec, SpecNode } from '../../src/spec/schema.js';
import { sampleSnippets } from './flow-fixture.js';

const meta = { generatedAt: new Date('2026-11-06T12:00:00Z'), repo: 'demo' };
const savedAt = '2026-11-06T10:00:00.000Z';
const node = (id: string, status: SpecNode['status'], extra: Partial<SpecNode> = {}): SpecNode => ({ id, label: id, kind: 'other', status, layer: 'l', ...extra });
const map = (kind: Spec['kind'], nodes: SpecNode[], extra: Partial<Spec> = {}): Spec => ({ title: 'T', kind, nodes, edges: [], ...extra });
const panelOf = (out: string, id: string) => out.match(new RegExp(`<template class="card-panel" data-for="${id}">(.*?)</template>`, 's'))![1]!;
const nodeOf = (out: string, id: string) => out.match(new RegExp(`<g class="node ([^"]*)" data-id="${id}"[^>]*>(.*?)</g>(?=<g class="(?:node|edge)|</g>|$)`, 's'))!;

async function mapHtml(plan: Spec, summary: Spec): Promise<string> {
  const drift = compareMaps({ spec: plan, savedAt }, summary);
  const ghosts = ghostsFor(drift, new Set(summary.nodes.map((n) => n.id)), plan.edges);
  return renderHtml(summary, await layoutSpec(withGhosts(summary, ghosts)), meta, undefined, undefined, ghosts);
}

const plan = map('plan', [node('a', 'new'), node('gone', 'new'), node('b', 'changed', { path: 'x.ts' })], { edges: [{ from: 'a', to: 'gone' }] });
const summary = (drift?: Spec['drift']) =>
  map('summary', [node('a', 'new'), node('b', 'changed', { path: 'y.ts' }), node('extra', 'new')], { ...(drift && { drift }) });

describe('map drift in HTML', () => {
  it('marks drifted nodes; a node with no reason is red', async () => {
    const out = await mapHtml(plan, summary([{ node: 'extra', cause: 'bug-found', why: 'needed it' }]));
    expect(nodeOf(out, 'extra')[2]).toMatch(/class="drift-mark"[^>]*><title>Built, not in the plan\. Found a bug<\/title>/);
    expect(nodeOf(out, 'b')[2]).toMatch(/class="drift-mark bad"[^>]*><title>Built differently\. No reason given<\/title>/);
    expect(nodeOf(out, 'a')[2]).not.toContain('drift-mark');
  });

  it('adds a Drift section to the panel with the reason', async () => {
    const out = await mapHtml(plan, summary([{ node: 'extra', cause: 'bug-found', why: 'needed it' }]));
    const extra = panelOf(out, 'extra');
    expect(extra).toContain('<div class="drift drift-unplanned"><button type="button" class="drift-chip" aria-expanded="false">');
    expect(extra).toContain('<b>Built, not in the plan</b><span class="drift-sub">This node was added, but the plan didn&#39;t include it.</span>');
    expect(extra).toContain('<div class="drift-rows" hidden>');
    expect(extra).toContain('<span class="drift-pill">Found a bug</span><div class="drift-note">needed it</div>');
    expect(extra).not.toContain('drift-why-btn');
    expect(extra).not.toContain('<span class="drift-l">Plan</span>');
    const b = panelOf(out, 'b');
    expect(b).toContain('<div class="drift drift-different">');
    expect(b).toContain('<span class="drift-l">Plan</span><div class="drift-v drift-plan"><code>x.ts</code></div>');
    expect(b).toContain('<span class="drift-l">Built</span><div class="drift-v drift-built"><code>y.ts</code></div>');
    expect(b).toContain('<div class="drift-warn">⚠ No reason given. Ask the agent why it changed.</div>');
    expect(b).not.toContain('drift-pill');
    expect(panelOf(out, 'a')).not.toContain('class="drift');
  });

  it('draws what was planned and not built as a ghost, with its link, and a panel', async () => {
    const out = await mapHtml(plan, summary());
    const [, cls, body] = nodeOf(out, 'gone');
    expect(cls).toContain('ghost');
    expect(body).toContain('>not built</text>');
    expect(panelOf(out, 'gone')).toContain('The plan said to add this node. It wasn&#39;t built.');
    expect(out).toMatch(/<g class="edge ghost" data-from="a" data-to="gone">/);
    expect(out).toContain('.node.ghost');
  });

  it('lists the drift in the page info, each item opening its panel', async () => {
    const out = await mapHtml(plan, summary([{ node: 'gone', cause: 'out-of-scope', why: 'Detailed text here.' }]));
    const info = out.match(/<section id="page-info">(.*?)<\/section>/s)![1]!;
    expect(info).toContain('<h3>Differences from the plan</h3>');
    expect(info).toContain('Compared with the plan “T” (drawn 2h ago, before the work).');
    expect(info).toMatch(/data-goto="gone" data-expand>gone<\/button>: In the plan, not built<br>/);
    expect(info).toContain('Left for later</span>');
    expect(info).not.toContain('Detailed text');
    expect(out).toContain('Differences / gaps');
  });

  it('says so when the build matches the plan', async () => {
    const same = map('plan', [node('a', 'new')]);
    const out = await mapHtml(same, map('summary', [node('a', 'new')]));
    expect(out).toContain('built as planned ✓ (plan “T”)');
    expect(out).not.toMatch(/class="node [^"]*ghost/);
  });

  it('does not show the Now/After panes for ghosts, and leaves a page without a plan unchanged', async () => {
    const s = summary();
    const out = await mapHtml(plan, s);
    expect(out).not.toContain('class="pane"');
    const without = renderHtml(s, await layoutSpec(s), meta);
    expect(without).not.toMatch(/class="drift|Differences from the|class="node [^"]*ghost/);
    expect(withGhosts(s, undefined)).toBe(s);
  });
});

const step = (id: string, status: FlowStep['status'], extra: Partial<FlowStep> = {}): FlowStep => ({ id, label: id, type: 'step', status, ...extra });
const flow = (kind: FlowSpec['kind'], steps: FlowStep[], links: FlowSpec['links'], extra: Partial<FlowSpec> = {}): FlowSpec => ({ diagram: 'flow', kind, title: 'F', start: 'a', steps, links, ...extra });

async function flowHtml(p: FlowSpec, s: FlowSpec): Promise<string> {
  const drift = compareFlows({ spec: p, savedAt }, s);
  const ghosts = ghostsFor(drift, new Set(s.steps.map((x) => x.id)), p.links);
  return renderFlowHtml(s, await layoutFlow(withGhostSteps(s, ghosts)), sampleSnippets(), meta, undefined, ghosts);
}

const flowPlan = flow('plan', [step('a', 'existing'), step('gone', 'planned'), step('b', 'planned')], [{ from: 'a', to: 'gone' }, { from: 'a', to: 'b' }]);
const flowSummary = (drift?: FlowSpec['drift']) =>
  flow('summary', [step('a', 'existing'), step('b', 'new'), step('extra', 'new')], [{ from: 'a', to: 'b' }, { from: 'a', to: 'extra' }], { ...(drift && { drift }) });

describe('edge labels and ghosts', () => {
  it('no edge label lands on a box, a ghost included', async () => {
    const edge = (from: string, to: string, label?: string) => ({ from, to, ...(label && { label }) });
    const built = map('summary', [node('users', 'changed'), node('teams', 'new'), node('idx', 'new'), node('api', 'new'), node('limit', 'new')], {
      edges: [edge('users', 'teams', 'teamId'), edge('api', 'teams'), edge('api', 'idx', 'indexUser'), edge('api', 'limit', 'allow')],
    });
    const planned = map('plan', [node('users', 'changed'), node('teams', 'new'), node('api', 'new'), node('audit', 'new')], {
      edges: [edge('users', 'teams', 'teamId'), edge('api', 'teams'), edge('api', 'audit', 'log join')],
    });
    const ghosts = ghostsFor(compareMaps({ spec: planned, savedAt }, built), new Set(built.nodes.map((x) => x.id)), planned.edges);
    expect(ghosts.nodes.map((g) => g.id)).toEqual(['audit']);
    const layout = await layoutSpec(withGhosts(built, ghosts));
    const labelled = layout.edges.filter((e) => e.label);
    expect(labelled).toHaveLength(4);
    for (const e of labelled) {
      const w = e.label!.length * 5.6 + 6;
      const box = { l: e.labelAt!.x - w / 2, r: e.labelAt!.x + w / 2, t: e.labelAt!.y - 8, b: e.labelAt!.y + 4 };
      for (const b of layout.nodes) {
        const apart = box.r <= b.x || box.l >= b.x + b.w || box.b <= b.y || box.t >= b.y + b.h;
        expect(apart, `${e.label} over ${b.id}`).toBe(true);
      }
    }
  });
});

describe('the difference chip and the relations footer', () => {
  const preview = { path: 'y.ts', lines: [{ kind: 'add' as const, n: 1, text: 'const x = 1;' }], total: 1, rows: 1 };

  it('sits after the summary and path and before the changes and fields; collapsed unless the node is a ghost', async () => {
    const built = map('summary', [node('a', 'new'), node('b', 'changed', { path: 'y.ts', summary: 'the b summary', fields: [{ name: 'f', change: 'added' }], fieldsComplete: true })]);
    const planned = map('plan', [node('a', 'new'), node('b', 'changed', { path: 'x.ts' }), node('gone', 'new', { summary: 'what gone does' })]);
    const drift = compareMaps({ spec: planned, savedAt }, built);
    const ghosts = ghostsFor(drift, new Set(['a', 'b']), planned.edges);
    const out = renderHtml(built, await layoutSpec(withGhosts(built, ghosts)), meta, undefined, new Map([['b', preview]]), ghosts);
    const b = panelOf(out, 'b');
    const at = (needle: string) => b.indexOf(needle);
    expect(b).not.toContain('class="path"');
    expect(b).toContain('<h3 class="ch-head">Changes<span class="ch-path">y.ts</span>');
    expect(at('the b summary')).toBeLessThan(at('class="drift-chip"'));
    expect(at('class="drift-chip"')).toBeLessThan(at('<h3 class="ch-head"'));
    expect(at('<h3 class="ch-head"')).toBeLessThan(at('<h3>Fields</h3>'));
    expect(b).toContain('aria-expanded="false"');
    const ghost = panelOf(out, 'gone');
    expect(ghost).toContain('class="drift-chip" aria-expanded="true"');
    expect(ghost).toContain('<div class="drift-rows">');
    expect(ghost).toContain('what gone does');
  });

  it('a flow step gets the chip, a ghost open, and a step that matches the plan none', async () => {
    const out = await flowHtml(flowPlan, flowSummary());
    const extra = panelOf(out, 'extra');
    expect(extra).toContain('aria-expanded="false"');
    expect(panelOf(out, 'gone')).toContain('class="drift-chip" aria-expanded="true"');
    const a = panelOf(out, 'a');
    expect(a).not.toContain('drift-chip');
    expect(panelOf(out, 'b')).not.toContain('drift-chip');
  });

  it('relations are a footer after the body, on every panel; none, no footer', async () => {
    const out = await mapHtml(plan, summary());
    const a = panelOf(out, 'a');
    expect(a).toMatch(/<div class="prel"><h3>Relations<\/h3>.*<\/div>$/s);
    expect(a.indexOf('class="ptitle"')).toBeLessThan(a.indexOf('class="prel"'));
    expect(panelOf(out, 'extra')).not.toContain('prel');
    const plain = renderHtml(summary(), await layoutSpec(summary()), meta);
    expect(plain).not.toContain('<div class="drift');
    const flowOut = await flowHtml(flowPlan, flowSummary());
    expect(panelOf(flowOut, 'a')).toContain('<div class="prel">');
  });
});

describe('the sentence on a difference', () => {
  const item = (extra: Partial<DriftItem<unknown>>): DriftItem<unknown> => ({ id: 'x', label: 'x', noun: 'service', kind: 'missing', ...extra });
  it.each([
    [{ change: 'add' }, "The plan said to add this service. It wasn't built."],
    [{ change: 'change' }, "The plan said to change this service. It wasn't built."],
    [{ change: 'change', detail: 'left unchanged' }, 'The plan said to change this service. It was left unchanged.'],
    [{ change: 'remove', detail: 'removal not done' }, 'The plan said to remove this service. It is still there.'],
    [{ kind: 'unplanned', change: 'add' }, "This service was added, but the plan didn't include it."],
    [{ kind: 'unplanned', change: 'change' }, "This service was changed, but the plan didn't include it."],
    [{ kind: 'different', plain: ['A.', 'B.'] }, 'A. B.'],
  ] as [Partial<DriftItem<unknown>>, string][])('%j', (extra, text) => {
    expect(sentence(item(extra))).toBe(text);
  });
});

describe('the node summary', () => {
  it('is the subheader in the panel header, before the path, and appears once, a ghost included', async () => {
    const planned = map('plan', [node('a', 'new'), node('gone', 'new', { summary: 'record team changes', path: 'g.ts' })]);
    const built = map('summary', [node('a', 'new', { summary: 'the a summary', path: 'a.ts' })]);
    const out = await mapHtml(planned, built);
    for (const [id, text] of [['a', 'the a summary'], ['gone', 'record team changes']] as const) {
      const panel = panelOf(out, id);
      expect(panel).toContain(`</h2><p class="psub">${text}</p></div>`);
      expect(panel.indexOf('class="psub"')).toBeLessThan(panel.indexOf('class="path"'));
      expect(panel.match(new RegExp(text, 'g'))).toHaveLength(1);
    }
    expect(panelOf(out, 'gone')).not.toContain('<span class="drift-l">Plan</span>');
  });

  it('is left out when the node has none', async () => {
    expect(panelOf(await mapHtml(plan, summary()), 'a')).not.toContain('psub');
  });
});
