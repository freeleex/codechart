import { describe, expect, it } from 'vitest';
import type { Preview } from '../../src/render/preview.js';
import { buildDoc } from '../../src/review/doc.js';
import { feedbackText } from '../../src/review/feedback.js';
import { carryNotes } from '../../src/review/carry.js';
import { flowSnapshot, mapSnapshot } from '../../src/review/snapshot.js';
import type { Spec } from '../../src/spec/schema.js';
import { sampleFlow, sampleSnippets } from '../render/flow-fixture.js';
import { note, review } from './fixture.js';

const EVIL = 'a\x1b]52;c;ZXZpbA==\x07b\x1b[2Jc​d\u{e0041}e';
// The escape bytes go; the printable rest is inert text.
const CLEAN = 'a]52;c;ZXZpbA==b[2Jcde';

describe('snapshots strip what could drive a terminal', () => {
  const spec = { title: 't', kind: 'summary', edges: [], nodes: [{ id: 'n', label: `L${EVIL}`, kind: 'model', status: 'changed', layer: 'x', path: 'a.ts' }] } as unknown as Spec;
  const preview: Preview = {
    path: `a${EVIL}.ts`,
    lines: [{ kind: 'hunk', text: `@@ -1 +1 @@ ${EVIL}` }, { kind: 'add', n: 1, text: EVIL }],
    total: 1,
    rows: 2,
    note: EVIL,
  };

  it('map labels, paths, line text and notes', () => {
    const [n] = mapSnapshot(spec, new Map([['n', preview]]), undefined).nodes;
    expect(n).toMatchObject({ label: `L${CLEAN}`, path: `a${CLEAN}.ts`, note: CLEAN });
    expect(n!.lines).toEqual([{ kind: 'hunk', text: `@@ -1 +1 @@ ${CLEAN}` }, { kind: 'add', n: 1, text: CLEAN }]);
  });

  it('flow labels and sources', () => {
    const flow = sampleFlow();
    flow.steps[0]!.label = EVIL;
    flow.steps[0]!.source = `a${EVIL}.ts:3`;
    const [n] = flowSnapshot(flow, sampleSnippets(), undefined).nodes;
    expect(n).toMatchObject({ label: CLEAN, path: `a${CLEAN}.ts` });
  });

  it('the document and the feedback sanitize whatever an older review file holds', () => {
    const r = review([note('n1', { body: EVIL, anchor: { path: 'p', side: 'new', line: 1, text: EVIL } })], [{ id: 'x', label: EVIL, lines: [{ kind: 'add', n: 1, text: EVIL }] }]);
    const out = buildDoc({ ...r, notes: [{ ...r.notes[0]!, node: 'x' }] }) + (feedbackText(r) ?? '');
    expect(out).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f​\u{e0000}-\u{e007f}]/u);
    expect(out).toContain(CLEAN);
  });
});

describe('flow step rev', () => {
  const rev = (mutate?: (f: ReturnType<typeof sampleFlow>, s: ReturnType<typeof sampleSnippets>) => void) => {
    const f = sampleFlow();
    const s = sampleSnippets();
    mutate?.(f, s);
    return flowSnapshot(f, s, undefined).nodes.map((n) => n.rev);
  };

  it('every step has a 12-char hash, stable for the same content', () => {
    expect(rev().every((r) => /^[0-9a-f]{12}$/.test(r ?? ''))).toBe(true);
    expect(rev()).toEqual(rev());
  });

  it('changes with the step label, its code, or an outgoing link (label, code)', () => {
    const base = rev();
    expect(rev((f) => (f.steps[1]!.label = 'which mode?'))[1]).not.toBe(base[1]);
    expect(rev((_f, s) => (s.steps.get('mode')!.lines = ['switch (kind) {']))[1]).not.toBe(base[1]);
    expect(rev((f) => (f.links[1]!.label = 'terminal'))[1]).not.toBe(base[1]);
    expect(rev((_f, s) => (s.links[1]!.lines = ['x']))[1]).not.toBe(base[1]);
    expect(rev((f) => (f.steps[1]!.label = 'which mode?'))[0]).toBe(base[0]);
  });

  it('a flow note turns outdated when its step changed on re-render', () => {
    const before = flowSnapshot(sampleFlow(), sampleSnippets(), undefined);
    const changed = sampleSnippets();
    changed.steps.get('mode')!.lines = ['switch (kind) {'];
    const after = flowSnapshot(sampleFlow(), changed, undefined);
    const r = review([note('n1', { node: 'mode', rev: before.nodes[1]!.rev }), note('n2', { node: 'read', rev: before.nodes[0]!.rev })], before.nodes);
    expect(carryNotes(r, after.nodes).map((n) => [n.node, n.state])).toEqual([['mode', 'outdated'], ['read', 'pending']]);
  });
});

describe('what a map shows besides its nodes', () => {
  const spec = {
    title: 't',
    kind: 'summary',
    nodes: [{ id: 'a', label: 'A', kind: 'model', status: 'changed', layer: 'x' }],
    edges: [{ from: 'a', to: 'b', label: `calls${EVIL}` }, { from: 'b', to: 'a' }],
    gaps: [`no tests${EVIL}`],
    omitted: ['cron'],
  } as unknown as Spec;
  const item = { id: 'g', label: `Ghost${EVIL}`, kind: 'missing' as const, noun: 'service' };

  it('map: arrows, gaps, not-on-map items and drift items, sanitized', () => {
    const snap = mapSnapshot(spec, undefined, undefined, [item]);
    expect(snap.edges).toEqual([{ from: 'a', to: 'b', label: `calls${CLEAN}` }, { from: 'b', to: 'a' }]);
    expect(snap).toMatchObject({ gaps: [`no tests${CLEAN}`], omitted: ['cron'], drift: [{ id: 'g', kind: 'missing', label: `Ghost${CLEAN}` }] });
  });

  it('map: nothing to list leaves the fields out', () => {
    const snap = mapSnapshot({ ...spec, edges: [], gaps: undefined, omitted: [] } as unknown as Spec, undefined, undefined, []);
    expect(Object.keys(snap)).toEqual(['kind', 'title', 'nodes']);
  });

  it('ghost links from the plan are listed after the spec\'s, sanitized, in maps and flows', () => {
    const ghost = [{ from: 'a', to: 'g', label: `plans${EVIL}` }];
    expect(mapSnapshot(spec, undefined, undefined, [], ghost).edges!.at(-1)).toEqual({ from: 'a', to: 'g', label: `plans${CLEAN}` });
    expect(flowSnapshot(sampleFlow(), sampleSnippets(), undefined, [], ghost).edges!.at(-1)).toEqual({ from: 'a', to: 'g', label: `plans${CLEAN}` });
  });

  it('flow: links with their labels and the gaps', () => {
    const f = { ...sampleFlow(), gaps: ['open question'] };
    const snap = flowSnapshot(f, sampleSnippets(), undefined, [item]);
    expect(snap.edges).toEqual(f.links.map((l) => ({ from: l.from, to: l.to, ...(l.label && { label: l.label }) })));
    expect(snap).toMatchObject({ gaps: ['open question'], drift: [{ id: 'g' }] });
    expect(snap.omitted).toBeUndefined();
  });
});
