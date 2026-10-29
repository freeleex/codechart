import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseConfigFile } from '../../src/config/schema.js';
import { wrapItems } from '../../src/render/terminal/wrap.js';
import { buildProgram, runProgram } from '../../src/program.js';
import { validateFlowSpec } from '../../src/spec/flow.js';
import { validateSpec } from '../../src/spec/schema.js';
import { sampleFlow } from '../render/flow-fixture.js';

const node = (i: number, over: Record<string, unknown> = {}) => ({
  id: `n${i}`, label: `node${i}`, kind: 'other', status: 'new', layer: 'l', ...over,
});
const map = (over: Record<string, unknown> = {}) => ({
  title: 't', kind: 'plan', nodes: [node(0), node(1)], edges: [{ from: 'n0', to: 'n1' }], ...over,
});
const time = <T>(fn: () => T): [T, number] => {
  const t = Date.now();
  const r = fn();
  return [r, Date.now() - t];
};

describe('S-7 string caps', () => {
  it.each([
    ['label', (n: number) => node(0, { label: 'x'.repeat(n) })],
    ['id', (n: number) => node(0, { id: 'x'.repeat(n) })],
    ['layer', (n: number) => node(0, { layer: 'x'.repeat(n) })],
  ])('map node %s <= 200', (_, make) => {
    const spec = (n: number) => map({ nodes: [make(n)], edges: [] });
    expect(validateSpec(spec(200)).ok).toBe(true);
    expect(validateSpec(spec(201)).ok).toBe(false);
  });

  it('map field name <= 200, summary and notes <= 2000, gaps <= 2000', () => {
    const ok = (over: (n: number) => Record<string, unknown>, n: number) => validateSpec(map({ nodes: [node(0, over(n))], edges: [] })).ok;
    expect(ok((n) => ({ fields: [{ name: 'x'.repeat(n) }], fieldsComplete: true }), 201)).toBe(false);
    expect(ok((n) => ({ summary: 'x'.repeat(n) }), 2000)).toBe(true);
    expect(ok((n) => ({ summary: 'x'.repeat(n) }), 2001)).toBe(false);
    expect(ok((n) => ({ notes: ['x'.repeat(n)] }), 2001)).toBe(false);
    expect(validateSpec(map({ gaps: ['x'.repeat(2000)] })).ok).toBe(true);
    expect(validateSpec(map({ gaps: ['x'.repeat(2001)] })).ok).toBe(false);
  });

  it('flow label/id <= 200, gaps <= 2000', () => {
    const base = sampleFlow();
    expect(validateFlowSpec({ ...base, gaps: ['x'.repeat(2000)] }).ok).toBe(true);
    expect(validateFlowSpec({ ...base, gaps: ['x'.repeat(2001)] }).ok).toBe(false);
    const steps = base.steps.map((s, i) => (i === 0 ? { ...s, label: 'x'.repeat(201) } : s));
    expect(validateFlowSpec({ ...base, steps }).ok).toBe(false);
  });
});

describe('S-7 caps do not reject previously valid empty optionals', () => {
  it('empty edge label, field type, rules entry', () => {
    const nodes = [node(0, { fields: [{ name: 'x', type: '' }], fieldsComplete: true }), node(1)];
    expect(validateSpec(map({ nodes, edges: [{ from: 'n0', to: 'n1', label: '' }], rules: [''] })).ok).toBe(true);
    expect(validateFlowSpec({ ...sampleFlow(), rules: [''] }).ok).toBe(true);
  });
});

describe('S-11 map size', () => {
  it('rejects more than 500 nodes or 1000 edges, telling the agent to split', () => {
    const nodes = Array.from({ length: 501 }, (_, i) => node(i));
    const r = validateSpec(map({ nodes, edges: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('split the map');
    const edges = Array.from({ length: 1001 }, () => ({ from: 'n0', to: 'n1' }));
    expect(validateSpec(map({ edges })).ok).toBe(false);
  });
});

describe('S-7 linear time', () => {
  it('wrapItems on one 320 KB word', () => {
    const [, ms] = time(() => wrapItems('gaps: ', ['x'.repeat(320_000)], 40));
    expect(ms).toBeLessThan(1500);
  });

  it('spec error normalisation with a 160 000-space key', () => {
    const [r, ms] = time(() => validateSpec({ ...map(), [' '.repeat(160_000)]: 1 }));
    expect(r.ok).toBe(false);
    expect(ms).toBeLessThan(1500);
  });

  it('config error normalisation with a 160 000-space key', () => {
    const [r, ms] = time(() => parseConfigFile({ [' '.repeat(160_000)]: 1 }));
    expect(r.ok).toBe(false);
    expect(ms).toBeLessThan(1500);
  });
});

describe('S-7 raw spec size', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'codechart-lim-'));
    mkdirSync(join(tmp, 'repo', '.git'), { recursive: true });
    process.exitCode = undefined;
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  async function run(arg: string, stdin: string) {
    let err = '';
    const program = buildProgram({
      cwd: join(tmp, 'repo'), home: join(tmp, 'h'), env: {}, stdout: () => {}, stderr: (s) => (err += s),
      stdin: async () => stdin, isTTY: false,
    });
    await runProgram(program, ['render', arg], 'user');
    return { err, code: process.exitCode };
  }

  const big = ' '.repeat(2 * 1024 * 1024 + 1);

  it('file over 2 MB is rejected before parsing', async () => {
    const file = join(tmp, 'big.json');
    writeFileSync(file, big);
    const r = await run(file, '');
    expect(r.code).toBe(1);
    expect(r.err).toBe(`codechart: ${file}: spec is larger than 2 MB\n`);
  });

  it('counts bytes, not characters', async () => {
    const r = await run('-', '\u20ac'.repeat(800_000));
    expect(r.err).toBe('codechart: stdin: spec is larger than 2 MB\n');
  });

  // /dev/zero does not exist on Windows
  it.skipIf(process.platform === 'win32')('refuses a non-regular spec file', async () => {
    const r = await run('/dev/zero', '');
    expect(r.code).toBe(1);
    expect(r.err).toBe('codechart: /dev/zero: not a regular file\n');
  });

  it.skipIf(process.platform === 'win32')('refuses a FIFO spec file without blocking', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codechart-fifo-'));
    try {
      const fifo = join(dir, 'spec.json');
      execFileSync('mkfifo', [fifo]);
      const cli = new URL('../../src/cli.ts', import.meta.url).pathname;
      const r = spawnSync(join(process.cwd(), 'node_modules/.bin/tsx'), [cli, 'render', fifo], { encoding: 'utf8', timeout: 15_000 });
      expect(r.error).toBeUndefined();
      expect(r.status).toBe(1);
      expect(r.stderr).toBe(`codechart: ${fifo}: not a regular file\n`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stdin over 2 MB is rejected', async () => {
    const r = await run('-', big);
    expect(r.code).toBe(1);
    expect(r.err).toBe('codechart: stdin: spec is larger than 2 MB\n');
  });
});
