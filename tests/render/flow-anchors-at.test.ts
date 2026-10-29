import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram, runProgram } from '../../src/program.js';
import { checkFlowAnchors } from '../../src/render/flow/anchors.js';
import type { FlowSpec } from '../../src/spec/flow.js';

let base: string;
let repo: string;
let old: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' }).trim();

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'codechart-anchors-at-'));
  repo = join(base, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'src/a.ts'), 'one\nif (old) {\nthree\n');
  writeFileSync(join(repo, 'src/gone.ts'), 'only then\n');
  writeFileSync(join(base, 'secret.txt'), 'TOPSECRET\n');
  git('add', '.');
  // symlink staged straight into the index so Windows runners without symlink privilege still cover it
  const target = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: join(base, 'secret.txt'), encoding: 'utf8' }).trim();
  git('update-index', '--add', '--cacheinfo', `120000,${target},src/link.txt`);
  git('commit', '-q', '-m', 'old');
  old = git('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'src/a.ts'), 'zero\none\nif (new) {\nthree\n');
  git('rm', '-q', 'src/gone.ts');
  git('commit', '-q', '-am', 'new');
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const spec = (source: string, match?: string): FlowSpec => ({
  diagram: 'flow',
  kind: 'summary',
  title: 't',
  start: 's',
  steps: [{ id: 's', label: 'a step', type: 'step', status: 'existing', source, match }],
  links: [],
});
const errorsAt = (s: FlowSpec, at?: string) => {
  const r = checkFlowAnchors(s, repo, at);
  return r.ok ? [] : r.errors;
};

describe('anchors at a commit', () => {
  it('resolves match and line anchors against the commit, not the working tree', () => {
    const r = checkFlowAnchors(spec('src/a.ts', 'if (old)'), repo, old);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(r.snippets.steps.get('s')).toEqual({ source: 'src/a.ts:2', startLine: 2, lines: ['if (old) {'] });
    expect(errorsAt(spec('src/a.ts', 'if (old)'))).toEqual(['steps[0].match: "if (old)" not found in src/a.ts']);
    expect(errorsAt(spec('src/gone.ts:1'), old)).toEqual([]);
    expect(errorsAt(spec('src/a.ts:4'), old)).toEqual(['steps[0].source: src/a.ts:4 not found (file has 3 lines)']);
  });

  it('reports a file missing at the commit', () => {
    expect(errorsAt(spec('src/gone.ts:1'), git('rev-parse', 'HEAD'))).toEqual([
      `steps[0].source: src/gone.ts:1 not found (file does not exist at ${git('rev-parse', 'HEAD').slice(0, 12)}; repo root is ${repo})`,
    ]);
  });

  it('keeps the sandbox: outside, .git, symlink, directory', () => {
    const cases: [string, string][] = [
      ['../secret.txt', 'steps[0].source: ../secret.txt is outside the repo'],
      ['.git/config', 'steps[0].source: .git/config is inside .git'],
      ['src/link.txt', `steps[0].source: src/link.txt is not a regular file at ${old.slice(0, 12)}`],
      ['src', `steps[0].source: src is not a regular file at ${old.slice(0, 12)}`],
    ];
    for (const [source, error] of cases) {
      const errors = errorsAt(spec(source, 'secret'), old);
      expect(errors).toEqual([error]);
      expect(errors.join('\n')).not.toContain('TOPSECRET');
    }
  });
});

describe('anchors at a commit, paths relative to the working directory', () => {
  const cwd = () => join(repo, 'src');

  it('normalises a cwd-relative path read from the commit', () => {
    const r = checkFlowAnchors(spec('a.ts', 'if (old)'), repo, old, cwd());
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(r.snippets.steps.get('s')).toEqual({ source: 'src/a.ts:2', startLine: 2, lines: ['if (old) {'] });
  });

  it('keeps the sandbox', () => {
    const at = (source: string) => {
      const r = checkFlowAnchors(spec(source, 'secret'), repo, old, cwd());
      return r.ok ? [] : r.errors;
    };
    expect(at('link.txt')).toEqual([`steps[0].source: src/link.txt is not a regular file at ${old.slice(0, 12)}`]);
    expect(at('../.git/config')).toEqual(['steps[0].source: .git/config is inside .git']);
  });

  it('names the repo root and the likely path at the commit', () => {
    const r = checkFlowAnchors(spec('a.ts:1'), repo, old);
    expect(r.ok ? [] : r.errors).toEqual([
      `steps[0].source: a.ts:1 not found (file does not exist at ${old.slice(0, 12)}; repo root is ${repo}; did you mean src/a.ts)`,
    ]);
  });
});

describe('render --at', () => {
  async function render(...args: string[]) {
    const file = join(base, 'spec.json');
    writeFileSync(file, JSON.stringify(spec('src/a.ts', 'if (old)')));
    let out = '';
    let err = '';
    process.exitCode = undefined;
    const program = buildProgram({ cwd: repo, home: join(base, 'home'), env: {}, stdout: (s) => (out += s), stderr: (s) => (err += s), isTTY: false });
    await runProgram(program, ['render', file, '--md', '--output', 'cli', ...args], 'user');
    const code = process.exitCode;
    process.exitCode = undefined;
    return { out, err, code };
  }

  it('renders with anchors from the commit', async () => {
    const r = await render('--at', old);
    expect(r.err).toBe('');
    expect(r.out).toContain('**Flow**');
  });

  it.each([
    [['--at', '--all'], 'codechart: --at must not start with "-"\n'],
    [['--at', 'nope'], 'codechart: --at nope is not a commit\n'],
  ])('rejects %j', async (args, err) => {
    const r = await render(...args);
    expect(r.out).toBe('');
    expect(r.err).toBe(err);
    expect(r.code).toBeGreaterThan(0);
  });
});
