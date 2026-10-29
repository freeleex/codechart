import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram, runProgram } from '../../src/program.js';
import { repoFolder } from '../../src/render/output-path.js';
import { gitChangedFiles } from '../../src/rules/git-files.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-fs-'));
  process.exitCode = undefined;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.exitCode = undefined;
});

describe('S-10 file modes', () => {
  // POSIX modes are not enforced on Windows
  it.skipIf(process.platform === 'win32')('cache dirs 0700 and HTML 0600', async () => {
    const repo = join(tmp, 'repo');
    const out = join(tmp, 'cache', 'out');
    mkdirSync(join(repo, '.git'), { recursive: true });
    mkdirSync(join(tmp, 'h', '.config', 'codechart'), { recursive: true });
    writeFileSync(join(tmp, 'h', '.config', 'codechart', 'config.yaml'), `web:\n  outDir: ${out}\n`);
    const spec = join(tmp, 'spec.json');
    writeFileSync(
      spec,
      JSON.stringify({
        title: 't', kind: 'plan', edges: [],
        nodes: [{ id: 'a', label: 'a', kind: 'other', status: 'new', layer: 'l' }],
      }),
    );
    const program = buildProgram({ cwd: repo, home: join(tmp, 'h'), env: {}, stdout: () => {}, stderr: () => {}, isTTY: false });
    await runProgram(program, ['render', spec, '--output', 'web'], 'user');
    const mode = (p: string) => statSync(p).mode & 0o777;
    const repoDir = join(out, readdirSync(out)[0]!);
    const html = join(repoDir, readdirSync(repoDir)[0]!);
    expect(mode(out)).toBe(0o700);
    expect(mode(repoDir)).toBe(0o700);
    expect(mode(html)).toBe(0o600);
  });
});

describe('S-10 existing cache folder', () => {
  it.skipIf(process.platform === 'win32')('is tightened to 0700', async () => {
    const repo = join(tmp, 'repo');
    const out = join(tmp, 'out');
    mkdirSync(join(repo, '.git'), { recursive: true });
    mkdirSync(join(tmp, 'h', '.config', 'codechart'), { recursive: true });
    writeFileSync(join(tmp, 'h', '.config', 'codechart', 'config.yaml'), `web:\n  outDir: ${out}\n`);
    const folder = join(out, repoFolder(repo));
    mkdirSync(folder, { recursive: true, mode: 0o755 });
    chmodSync(folder, 0o755);
    const spec = join(tmp, 'spec.json');
    writeFileSync(spec, JSON.stringify({ title: 't', kind: 'plan', edges: [], nodes: [{ id: 'a', label: 'a', kind: 'other', status: 'new', layer: 'l' }] }));
    const program = buildProgram({ cwd: repo, home: join(tmp, 'h'), env: {}, stdout: () => {}, stderr: () => {}, isTTY: false });
    await runProgram(program, ['render', spec, '--output', 'web'], 'user');
    expect(statSync(folder).mode & 0o777).toBe(0o700);
  });
});

describe('S-12 git status', () => {
  it('does not run core.fsmonitor from the checkout config', () => {
    const repo = join(tmp, 'repo');
    mkdirSync(repo);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    const marker = join(tmp, 'pwned');
    const hook = join(tmp, 'hook.sh');
    writeFileSync(hook, `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
    execFileSync('git', ['config', 'core.fsmonitor', hook], { cwd: repo });
    writeFileSync(join(repo, 'a.txt'), 'a');
    gitChangedFiles(repo);
    expect(existsSync(marker)).toBe(false);
  });
});
