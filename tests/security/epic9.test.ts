import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openArgv } from '../../src/commands/open.js';
import { buildProgram, runProgram } from '../../src/program.js';
import { checkFlowAnchors } from '../../src/render/flow/anchors.js';
import { gitBinary, gitChangedFiles, gitFileAt, gitSinceFiles } from '../../src/rules/git-files.js';
import type { FlowSpec } from '../../src/spec/flow.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-sec9-'));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();

function initRepo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

const flow = (source: string, match?: string): FlowSpec => ({
  diagram: 'flow',
  kind: 'summary',
  title: 't',
  start: 's',
  steps: [{ id: 's', label: 'a step', type: 'step', status: 'existing', source, match }],
  links: [],
});

// The markers are written by sh scripts git runs, which Windows runners may not have.
describe.skipIf(process.platform === 'win32')('S-22 partial clone: no lazy fetch', () => {
  it('render --at and check --since never fetch missing objects (no network, no core.sshCommand)', () => {
    const srv = initRepo(join(tmp, 'srv'));
    git(srv, 'config', 'uploadpack.allowFilter', 'true');
    writeFileSync(join(srv, 'f.txt'), 'old\nhello world\n');
    git(srv, 'add', '.');
    git(srv, 'commit', '-qm', 'one');
    git(srv, 'mv', 'f.txt', 'g.txt');
    writeFileSync(join(srv, 'g.txt'), 'old\nhello world!\n');
    git(srv, 'commit', '-qam', 'two');
    const repo = join(tmp, 'pc');
    execFileSync('git', ['clone', '-q', '--filter=blob:none', `file://${srv}`, repo], { stdio: 'pipe' });
    const marker = join(tmp, 'pwned');
    git(repo, 'config', 'remote.origin.url', 'ssh://evil.invalid/x');
    git(repo, 'config', 'core.sshCommand', `touch '${marker}'; false`);

    const r = checkFlowAnchors(flow('f.txt', 'hello'), repo, git(repo, 'rev-parse', 'HEAD~1'));
    expect(r.ok).toBe(false);
    gitSinceFiles(repo, 'HEAD~1');
    expect(existsSync(marker)).toBe(false);
  });
});

describe.skipIf(process.platform === 'win32')('S-23 git status and repo config', () => {
  it('runs no clean/process filter and no post-index-change hook from the checkout config', () => {
    const repo = initRepo(join(tmp, 'repo'));
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    writeFileSync(join(repo, '.gitattributes'), '* filter=evil\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'one');
    const marker = (n: string) => join(tmp, n);
    git(repo, 'config', 'filter.evil.clean', `touch '${marker('clean')}'; cat`);
    git(repo, 'config', 'filter.evil.process', `touch '${marker('process')}'`);
    mkdirSync(join(tmp, 'hooks'));
    writeFileSync(join(tmp, 'hooks', 'post-index-change'), `#!/bin/sh\ntouch '${marker('hook')}'\n`, { mode: 0o755 });
    git(repo, 'config', 'core.hooksPath', join(tmp, 'hooks'));
    // stat-dirty, so status has to compare content
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    execFileSync('touch', ['-t', '200001010000', join(repo, 'a.txt')]);

    expect(gitChangedFiles(repo)).toEqual([]);
    for (const m of ['clean', 'process', 'hook']) expect(existsSync(marker(m)), m).toBe(false);
  });

  it('does not fail on a required repo-local filter (git-crypt, lfs) and still runs none', () => {
    const repo = initRepo(join(tmp, 'repo'));
    writeFileSync(join(repo, 'a.s'), 'a\n');
    writeFileSync(join(repo, '.gitattributes'), '*.s filter=foo\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'one');
    const marker = join(tmp, 'clean');
    git(repo, 'config', 'filter.foo.clean', `touch '${marker}'; cat`);
    git(repo, 'config', 'filter.foo.required', 'true');
    execFileSync('touch', ['-t', '200001010000', join(repo, 'a.s')]);

    expect(gitChangedFiles(repo)).toEqual([]);
    expect(existsSync(marker)).toBe(false);
  });
});

describe('git error label', () => {
  it('names the subcommand, not a leading option', () => {
    const repo = initRepo(join(tmp, 'repo'));
    expect(() => gitFileAt(repo, 'deadbeef', 'a.txt', 100)).toThrow(/^git ls-tree failed/);
  });
});

describe('S-24 Windows executable lookup', () => {
  const exists = (p: string) => p === 'C:\\Git\\cmd\\git.exe';

  it('takes git from an absolute PATH entry, never a bare name the child cwd could satisfy', () => {
    expect(gitBinary('win32', { PATH: '.;relative\\bin;C:\\Git\\cmd' }, exists)).toBe('C:\\Git\\cmd\\git.exe');
    expect(gitBinary('win32', { Path: 'C:\\Git\\cmd' }, exists)).toBe('C:\\Git\\cmd\\git.exe');
    expect(() => gitBinary('win32', { PATH: '.;C:\\nope' }, exists)).toThrow('git not found on PATH');
    expect(gitBinary('linux', {}, exists)).toBe('git');
  });

  it('accepts a quoted PATH entry', () => {
    expect(gitBinary('win32', { PATH: '"C:\\Git\\cmd"' }, exists)).toBe('C:\\Git\\cmd\\git.exe');
  });

  it('opens with rundll32 from the system directory', () => {
    expect(openArgv('win32', 'C:\\a.html', { SystemRoot: 'D:\\Win' })).toEqual([
      'D:\\Win\\System32\\rundll32.exe',
      ['url.dll,FileProtocolHandler', 'C:\\a.html'],
    ]);
    expect(openArgv('win32', 'C:\\a.html', {})[0]).toBe('C:\\Windows\\System32\\rundll32.exe');
  });
});

describe('S-25 anchors: total bytes per render', () => {
  it('stops reading once the anchored files pass 25 MB together', () => {
    const repo = initRepo(join(tmp, 'repo'));
    const body = `${'x'.repeat(99)}\n`.repeat(45_000);
    const steps = Array.from({ length: 7 }, (_, i) => {
      writeFileSync(join(repo, `f${i}.txt`), `${body}needle ${i}\n`);
      return { id: `s${i}`, label: `s${i}`, type: 'step' as const, status: 'existing' as const, source: `f${i}.txt`, match: `needle ${i}` };
    });
    const spec: FlowSpec = { ...flow('x'), steps, links: steps.slice(1).map((s, i) => ({ from: `s${i}`, to: s.id })) };
    const r = checkFlowAnchors(spec, repo);
    if (r.ok) throw new Error('expected the budget to trip');
    expect(r.errors).toEqual(['steps[5].source: f5.txt not read: the anchored files pass 25 MB together; anchor fewer or smaller files', 'steps[6].source: f6.txt not read: the anchored files pass 25 MB together; anchor fewer or smaller files']);
  });

  it('counts a file anchored many times once', () => {
    const repo = initRepo(join(tmp, 'repo'));
    writeFileSync(join(repo, 'big.txt'), `${`${'x'.repeat(99)}\n`.repeat(45_000)}needle\n`);
    const steps = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, label: `s${i}`, type: 'step' as const, status: 'existing' as const, source: 'big.txt', match: 'needle' }));
    const spec: FlowSpec = { ...flow('x'), steps, links: steps.slice(1).map((s, i) => ({ from: `s${i}`, to: s.id })) };
    expect(checkFlowAnchors(spec, repo).ok).toBe(true);
  });
});

describe('S-26 anchors inside a nested .git', () => {
  it('rejects a .git segment anywhere in the path, on disk and at a commit', () => {
    const repo = initRepo(join(tmp, 'repo'));
    const nested = initRepo(join(repo, 'vendor', 'x'));
    git(nested, 'config', 'remote.origin.url', 'https://u:TOKEN@example.com/r.git');
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-qm', 'one');
    for (const at of [undefined, git(repo, 'rev-parse', 'HEAD')]) {
      const r = checkFlowAnchors(flow('vendor/x/.git/config', 'url ='), repo, at);
      expect(r.ok ? [] : r.errors).toEqual(['steps[0].source: vendor/x/.git/config is inside .git']);
    }
  });
});

describe('S-27 check JSON and invisible characters', () => {
  it('escapes bidi and zero-width characters in file names', async () => {
    let out = '';
    const program = buildProgram({ cwd: tmp, home: join(tmp, 'h'), env: {}, stdout: (s) => (out += s), stderr: () => {}, isTTY: false });
    writeFileSync(join(tmp, '.codechart.yaml'), 'rules:\n  - name: all\n    paths: ["**"]\n');
    await runProgram(program, ['check', '--files', 'invoice\u202efdp.exe,a\u200bb'], 'user');
    process.exitCode = undefined;
    expect(out).not.toMatch(/[\u200b\u202e]/);
    expect(JSON.parse(out).pathMatches[0].files).toEqual(['invoice\u202efdp.exe', 'a\u200bb']);
  });
});
