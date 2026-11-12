import { describe, expect, it } from 'vitest';
import type { MapCheck } from '../../src/render/check.js';
import { gapBoxes, withGaps } from '../../src/render/web/gaps.js';
import { validateSpec, type Spec } from '../../src/spec/schema.js';

function map(raw: unknown): Spec {
  const result = validateSpec(raw);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  if (result.spec.diagram === 'flow') throw new Error('expected a map spec');
  return result.spec;
}

const node = (id: string, layer: string, path: string) => ({ id, label: id, kind: 'service', status: 'context', layer, path });

const check = (explained: string[][]): MapCheck => ({ checked: 0, mismatches: [], matches: new Map(), blocks: new Map(), found: new Map(), unit: 'node', explained });

describe('gapBoxes: omitted groups drawn on the map', () => {
  it('an entry that says why gets a box in the layer its folder uses', () => {
    const spec = map({
      title: 'Telemetry',
      kind: 'summary',
      nodes: [node('tracker', 'frontend', 'frontend/src/services/telemetry.ts')],
      edges: [],
      omitted: ['frontend pages and components calling telemetry: frontend/src/pages/, frontend/src/screens/'],
    });
    const [box] = gapBoxes(spec);
    expect(box).toMatchObject({
      entry: 0,
      id: 'omitted-0',
      layer: 'frontend',
      prose: 'frontend pages and components calling telemetry',
      paths: ['frontend/src/pages/', 'frontend/src/screens/'],
      files: [],
      filesKnown: false,
    });
  });

  it('a bare tests or docs list stays in the page info: no reason, no box', () => {
    const spec = map({
      title: 'X',
      kind: 'summary',
      nodes: [node('svc', 'backend', 'backend/app/service.py')],
      edges: [],
      omitted: ['tests: backend/tests/*, frontend/src/**/*.test.*', 'docs: docs/architecture.md, README.md', 'tests and docs: tests/*, docs/*'],
    });
    expect(gapBoxes(spec)).toEqual([]);
  });

  it('one box per folder, in an existing layer or the folder as a new one', () => {
    const spec = map({
      title: 'X',
      kind: 'summary',
      nodes: [node('svc', 'backend', 'backend/app/service.py')],
      edges: [],
      omitted: ['~25 services rewritten from log() to log_event: backend/app/services/, frontend/src/pages/'],
    });
    expect(gapBoxes(spec).map((g) => [g.layer, g.paths])).toEqual([
      ['backend', ['backend/app/services/']],
      ['frontend', ['frontend/src/pages/']],
    ]);
    expect(new Set(gapBoxes(spec).map((g) => g.id)).size).toBe(2);
  });

  it('splits the changed files the entry explains by folder', () => {
    const spec = map({
      title: 'X',
      kind: 'summary',
      nodes: [node('svc', 'backend', 'backend/app/service.py')],
      edges: [],
      omitted: ['many callers, too many to draw: backend/app/services/, frontend/src/pages/'],
    });
    const boxes = gapBoxes(spec, check([['backend/app/services/a.py', 'frontend/src/pages/b.tsx']]));
    expect(boxes.map((g) => [g.layer, g.files, g.filesKnown])).toEqual([
      ['backend', ['backend/app/services/a.py'], true],
      ['frontend', ['frontend/src/pages/b.tsx'], true],
    ]);
  });

  it('withGaps adds the boxes to the layout spec only, as plain context nodes', () => {
    const spec = map({
      title: 'X',
      kind: 'summary',
      nodes: [node('svc', 'backend', 'backend/app/service.py')],
      edges: [],
      omitted: ['many callers, too many to draw: backend/app/services/'],
    });
    const laid = withGaps(spec, gapBoxes(spec));
    expect(laid.nodes.map((n) => n.id)).toEqual(['svc', 'omitted-0']);
    expect(laid.nodes[1]).toMatchObject({ label: 'many callers, too many to draw', layer: 'backend', status: 'context', kind: 'other', summary: 'backend/app/services/' });
    expect(spec.nodes).toHaveLength(1);
  });

  it('no omitted entries, no boxes', () => {
    expect(gapBoxes(map({ title: 'X', kind: 'summary', nodes: [node('svc', 'backend', 'backend/app/service.py')], edges: [] }))).toEqual([]);
  });
});
