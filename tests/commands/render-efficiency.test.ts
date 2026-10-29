import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram, runProgram } from '../../src/program.js';
import { repoFolder } from '../../src/render/output-path.js';
import { sampleFlow } from '../render/flow-fixture.js';

let tmp: string;
let home: string;
let repo: string;
let out: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-render-eff-'));
  home = join(tmp, 'home');
  repo = join(tmp, 'myrepo');
  out = join(tmp, 'out');
  mkdirSync(join(home, '.config', 'codechart'), { recursive: true });
  writeFileSync(join(home, '.config', 'codechart', 'config.yaml'), `web:\n  outDir: ${JSON.stringify(out)}\n`);
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'render.ts'), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n'));
  process.exitCode = undefined;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.exitCode = undefined;
});


async function render(spec: unknown, ...args: string[]) {
  const file = join(tmp, 'spec.json');
  writeFileSync(file, JSON.stringify(spec));
  let stdout = '';
  let stderr = '';
  const program = buildProgram({
    cwd: repo,
    home,
    env: {},
    stdout: (s) => (stdout += s),
    stderr: (s) => (stderr += s),
    now: () => new Date(2026, 9, 28, 9, 5, 3),
    isTTY: false,
  });
  await runProgram(program, ['render', file, ...args], 'user');
  return { out: stdout, err: stderr, code: process.exitCode };
}

const repoConfig = (yaml: string) => writeFileSync(join(repo, '.codechart.yaml'), yaml);

const html = () => {
  const dir = join(out, repoFolder(repo));
  return readFileSync(join(dir, readdirSync(dir)[0]!), 'utf8');
};

describe('render: content anchors', () => {
  it('a match anchor renders the resolved line in the panel', async () => {
    const flow = sampleFlow();
    flow.steps[1] = { ...flow.steps[1]!, source: 'src/render.ts', match: 'line 14' };
    const r = await render(flow, '--output', 'both');
    expect(r.err).toBe('');
    expect(html()).toContain('<div class="path">src/render.ts:14</div><pre class="snippet"><code><span class="ln">14</span>line 14</code></pre>');
  });

  it('an ambiguous match fails the render with the line numbers', async () => {
    const flow = sampleFlow();
    flow.steps[1] = { ...flow.steps[1]!, source: 'src/render.ts', match: 'line 2' };
    const r = await render(flow, '--output', 'both');
    expect(r.code).toBe(1);
    expect(r.err).toBe(
      'steps[1].match: "line 2" is on 11 lines of src/render.ts (2, 20, 21, 22, 23, 24, 25, 26, 27, 28 and 1 more); quote a more distinctive piece of the line or drop match and use source \'src/render.ts:2\'\n',
    );
  });
});

describe('render: spec defaults', () => {
  it('a flow without diagram and step types renders byte-identical to the explicit spec', async () => {
    const explicit = await render(sampleFlow(), '--output', 'cli', '--md');
    const bare = sampleFlow() as Partial<ReturnType<typeof sampleFlow>>;
    delete bare.diagram;
    const steps = bare.steps!.map((s) => ({ ...s, type: undefined }));
    const inferred = await render({ ...bare, steps }, '--output', 'cli', '--md');
    expect(inferred.err).toBe('');
    expect(inferred.out).toBe(explicit.out);
  });

  it('a map node with path and no kind renders like kind: file', async () => {
    const node = { id: 'a', label: 'render command', status: 'changed', layer: 'backend', path: 'src/render.ts' };
    const map = (n: object) => ({ title: 't', kind: 'summary', nodes: [n], edges: [] });
    const explicit = await render(map({ ...node, kind: 'file' }), '--output', 'cli', '--md');
    const inferred = await render(map(node), '--output', 'cli', '--md');
    expect(inferred.err).toBe('');
    expect(inferred.out).toBe(explicit.out);
  });
});

describe('render: output none says why', () => {
  const map = (extra: object = {}) => ({ title: 't', kind: 'summary', nodes: [], edges: [], ...extra });

  it('rules resolving to none: one stderr line, nothing on stdout, exit 0', async () => {
    repoConfig('rules:\n  - name: skip\n    paths: ["x/**"]\n    output: none\n  - name: gen\n    when: "generated code"\n    output: none\n');
    const r = await render(map({ rules: ['skip', 'gen'] }));
    expect(r).toEqual({ out: '', err: 'codechart: no map drawn: its rules (skip, gen) resolve to output none\n', code: undefined });
  });

  it('defaults.output none for a flow without rules', async () => {
    repoConfig('defaults:\n  output: none\n');
    const r = await render(sampleFlow());
    expect(r).toEqual({ out: '', err: 'codechart: no flow drawn: defaults.output is none\n', code: undefined });
  });

  it('--output overrides none and prints no notice', async () => {
    repoConfig('defaults:\n  output: none\n');
    const r = await render(sampleFlow(), '--output', 'cli');
    expect(r.err).toBe('');
    expect(r.out).toContain('output mode?');
  });
});
