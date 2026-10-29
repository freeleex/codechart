import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkFlowAnchors } from '../../src/render/flow/anchors.js';
import { renderFlowHtml } from '../../src/render/flow/html.js';
import { layoutFlow } from '../../src/render/flow/layout.js';
import { renderFlowTree } from '../../src/render/flow/tree.js';
import { validateFlowSpec } from '../../src/spec/flow.js';

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'codechart-ids-'));
  mkdirSync(join(repo, 'src'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  writeFileSync(join(repo, 'src/a.ts'), 'one\ntwo\nthree\n');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('ids that collide with Object.prototype', () => {
  const raw = {
    diagram: 'flow',
    kind: 'summary',
    title: 't',
    start: 'constructor',
    steps: [
      { id: 'constructor', label: 'first', type: 'step', status: 'existing', source: 'src/a.ts:1' },
      { id: 'toString', label: 'second', type: 'step', status: 'existing', source: 'src/a.ts:2' },
      { id: '__proto__', label: 'third', type: 'end', status: 'existing' , source: 'src/a.ts:3' },
    ],
    links: [
      { from: 'constructor', to: 'toString' },
      { from: 'toString', to: '__proto__' },
    ],
  };

  it('renders terminal and HTML', async () => {
    const r = validateFlowSpec({ ...raw, steps: raw.steps.slice(0, 3) });
    if (!r.ok) throw new Error(r.errors.join('\n'));
    const anchors = checkFlowAnchors(r.spec, repo);
    if (!anchors.ok) throw new Error(anchors.errors.join('\n'));
    const tree = renderFlowTree(r.spec, { maxNodes: 20, width: 80, color: false });
    expect(tree.text).toContain('first → second → third');
    const page = renderFlowHtml(r.spec, await layoutFlow(r.spec), anchors.snippets, {
      generatedAt: new Date('2026-10-28T00:00:00Z'),
      repo: 'demo',
    });
    expect(page).toContain('three');
  });

  it('does not find an inherited member for an id without a snippet', async () => {
    const steps = [
      { id: 'constructor', label: 'first', type: 'step', status: 'existing', source: 'src/a.ts:1' },
      { id: 'toString', label: 'second', type: 'end', status: 'planned' },
    ];
    const r = validateFlowSpec({ ...raw, steps, links: [{ from: 'constructor', to: 'toString' }], kind: 'plan' });
    if (!r.ok) throw new Error(r.errors.join('\n'));
    const anchors = checkFlowAnchors(r.spec, repo);
    if (!anchors.ok) throw new Error(anchors.errors.join('\n'));
    const page = renderFlowHtml(r.spec, await layoutFlow(r.spec), anchors.snippets, {
      generatedAt: new Date('2026-10-28T00:00:00Z'),
      repo: 'demo',
    });
    expect(page).toContain('Planned: not in the code yet.');
  });
});
