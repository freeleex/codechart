import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram, runProgram } from '../../src/program.js';
import { repoFolder } from '../../src/render/output-path.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-outdir-'));
  process.exitCode = undefined;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.exitCode = undefined;
});

async function render(out: string, setup?: (repo: string) => void) {
  const repo = join(tmp, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(tmp, 'h', '.config', 'codechart'), { recursive: true });
  writeFileSync(join(tmp, 'h', '.config', 'codechart', 'config.yaml'), `web:\n  outDir: ${out}\n`);
  setup?.(repo);
  const spec = join(tmp, 'spec.json');
  writeFileSync(spec, JSON.stringify({ title: 't', kind: 'plan', edges: [], nodes: [{ id: 'a', label: 'a', kind: 'other', status: 'new', layer: 'l' }] }));
  let err = '';
  const program = buildProgram({ cwd: repo, home: join(tmp, 'h'), env: {}, stdout: () => {}, stderr: (s) => (err += s), isTTY: false });
  await runProgram(program, ['render', spec, '--output', 'web'], 'user');
  return { err, repo };
}

describe('symlinked output dirs', () => {
  it('a symlinked global outDir is allowed', async () => {
    const real = join(tmp, 'real');
    mkdirSync(real);
    const link = join(tmp, 'link');
    symlinkSync(real, link);
    const { err } = await render(link);
    expect(err).toBe('');
    expect(process.exitCode).toBeFalsy();
    expect(dirExists(join(real, repoFolder(join(tmp, 'repo'))))).toBe(true);
  });

  it('a symlinked per-repo folder is refused', async () => {
    const out = join(tmp, 'out');
    const victim = join(tmp, 'victim');
    mkdirSync(out);
    mkdirSync(victim);
    const { err } = await render(out, (repo) => symlinkSync(victim, join(out, repoFolder(repo))));
    expect(err).toContain('is a symlink; refusing to write');
    expect(process.exitCode).toBe(1);
  });
});

function dirExists(p: string): boolean {
  return statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
}
