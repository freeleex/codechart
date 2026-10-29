import type { FlowSnippets } from '../../src/render/flow/anchors.js';
import type { FlowSpec } from '../../src/spec/flow.js';

export function sampleFlow(): FlowSpec {
  return {
    diagram: 'flow',
    kind: 'plan',
    title: 'render flow',
    start: 'read',
    steps: [
      { id: 'read', label: 'read file or stdin', type: 'step', status: 'existing', source: 'src/render.ts:10-12' },
      { id: 'mode', label: 'output mode?', type: 'decision', status: 'existing', source: 'src/render.ts:14' },
      { id: 'print', label: 'print terminal map', type: 'end', status: 'existing', source: 'src/render.ts:20' },
      { id: 'web', label: 'write html file', type: 'step', status: 'planned' },
      { id: 'done', label: 'done', type: 'end', status: 'planned' },
    ],
    links: [
      { from: 'read', to: 'mode' },
      { from: 'mode', to: 'print', label: 'cli', source: 'src/render.ts:20' },
      { from: 'mode', to: 'web', label: 'web' },
      { from: 'web', to: 'done' },
      { from: 'mode', to: 'done', label: 'none', planned: true },
    ],
    gaps: ['did not check stdin TTY'],
  };
}

export function sampleSnippets(): FlowSnippets {
  return {
    steps: new Map([
      ['read', { source: 'src/render.ts:10-12', startLine: 10, lines: ['const a = 1;', 'const b = 2;', 'return a;'] }],
      ['mode', { source: 'src/render.ts:14', startLine: 14, lines: ['switch (mode) {'] }],
      ['print', { source: 'src/render.ts:20', startLine: 20, lines: ['print(map);'] }],
    ]),
    links: { 1: { source: 'src/render.ts:20', startLine: 20, lines: ['case "cli": print(map);'] } },
  };
}
