import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderFlowTree } from '../../src/render/flow/tree.js';
import { renderTerminal } from '../../src/render/terminal/render.js';
import { flat } from '../../src/render/terminal/wrap.js';
import type { Spec } from '../../src/spec/schema.js';
import { sampleFlow } from './flow-fixture.js';

const teams = JSON.parse(readFileSync(new URL('../fixtures/shop.spec.json', import.meta.url), 'utf8')) as Spec;
const hostile = ['clear\u001b[2Jscreen', 'link \u001b]8;;https://evil\u0007x\u001b]8;;\u0007', 'csi\u009b2J\nnext'];
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;

describe('control characters in spec text', () => {
  it('flat strips C0, DEL and C1', () => {
    expect(flat('a\u001bb\u007fc\u009bd\u0085e')).toBe('a b c d e');
  });

  it('map footer gaps and omitted reach the terminal flattened', () => {
    const out = renderTerminal({ ...teams, gaps: hostile, omitted: hostile }, { maxNodes: 20, width: 80, color: false });
    expect(out).not.toMatch(CONTROL);
    expect(out).toContain('clear [2Jscreen');
  });

  it('flow footer gaps reach the terminal flattened', () => {
    const { text } = renderFlowTree({ ...sampleFlow(), gaps: hostile }, { maxNodes: 30, width: 80, color: false });
    expect(text).not.toMatch(CONTROL);
    expect(text).toContain('csi 2J next');
  });
});
