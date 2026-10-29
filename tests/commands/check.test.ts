import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram, runProgram } from '../../src/program.js';

let tmp: string;
let home: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-check-'));
  home = join(tmp, 'home');
  mkdirSync(home);
  process.exitCode = undefined;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.exitCode = undefined;
});

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function makeRepo(): string {
  const repo = join(tmp, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'T');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'a.txt'), 'a');
  writeFileSync(join(repo, 'old.txt'), 'old');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  return repo;
}

// check prints unmatched files only when something is excluded; a catch-all rule echoes every file.
function catchAll(repo: string) {
  writeFileSync(join(repo, '.codechart.yaml'), 'useBuiltinRules: false\nrules:\n  - name: any\n    paths: ["**"]\n');
}

async function run(cwd: string, args: string[]) {
  let out = '';
  let err = '';
  const program = buildProgram({
    cwd,
    home,
    env: {},
    stdout: (s) => (out += s),
    stderr: (s) => (err += s),
  });
  await runProgram(program, args[0]?.startsWith('--h') ? args : ['check', ...args], 'user');
  return { out, err, code: process.exitCode };
}

describe('codechart check', () => {
  it('--files lists path matches as JSON', async () => {
    const { out, code } = await run(tmp, ['--files', 'migrations/1.sql']);
    expect(code).toBeUndefined();
    expect(out.endsWith('\n')).toBe(true);
    expect(JSON.parse(out).pathMatches[0].rule).toBe('migrations');
  });

  it('--git lists modified and untracked files', async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, 'a.txt'), 'changed');
    writeFileSync(join(repo, 'migrations.sql'), 'x');
    mkdirSync(join(repo, 'migrations'));
    writeFileSync(join(repo, 'migrations', 'new.sql'), 'x');
    catchAll(repo);
    const { out } = await run(repo, ['--git']);
    const result = JSON.parse(out);
    const all = [
      ...result.pathMatches.flatMap((m: { files: string[] }) => m.files),
    ];
    expect(all).toContain('a.txt');
    expect(all).toContain('migrations/new.sql');
  });

  it('--git takes the new path of a rename and includes deletions', async () => {
    const repo = makeRepo();
    git(repo, 'mv', 'old.txt', 'renamed.txt');
    git(repo, 'rm', '-q', 'a.txt');
    catchAll(repo);
    const { out } = await run(repo, ['--git']);
    const result = JSON.parse(out);
    const all = [
      ...result.pathMatches.flatMap((m: { files: string[] }) => m.files),
    ];
    expect(all).toContain('renamed.txt');
    expect(all).toContain('a.txt');
    expect(all).not.toContain('old.txt');
  });

  it('--git outside a repo errors with exit code 2', async () => {
    const { err, code, out } = await run(tmp, ['--git']);
    expect(err).toBe('codechart: not a git repository (use --files)\n');
    expect(code).toBe(2);
    expect(out).toBe('');
  });

  it('neither --files nor --git is a usage error with exit code 2', async () => {
    const { err, code } = await run(tmp, []);
    expect(err).toMatch(/--files|--git/);
    expect(code).toBe(2);
  });

  it('--files and --git together is a usage error', async () => {
    const { code } = await run(tmp, ['--files', 'a', '--git']);
    expect(code).toBe(2);
  });

  it('--files paths resolve against cwd, relativized to the repo root', async () => {
    const repo = makeRepo();
    mkdirSync(join(repo, 'sub'));
    const { out } = await run(join(repo, 'sub'), ['--files', '../migrations/1.sql']);
    const result = JSON.parse(out);
    expect(result.pathMatches[0].rule).toBe('migrations');
    expect(result.pathMatches[0].files).toEqual(['migrations/1.sql']);
  });

  it('omits empty fields and does not echo unmatched files', async () => {
    const result = JSON.parse((await run(tmp, ['--files', 'src/a.ts,src/b.ts', '--matched', ''])).out);
    expect(Object.keys(result)).toEqual(['final']);
  });

  it('prints excludedFiles and remainingFiles when a none rule claims files', async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, '.codechart.yaml'), 'rules:\n  - name: gen\n    paths: ["gen/**"]\n    output: none\n');
    const result = JSON.parse((await run(repo, ['--files', 'gen/a.ts,src/b.ts'])).out);
    expect(result.excludedFiles).toEqual({ map: ['gen/a.ts'], flow: [] });
    expect(result.remainingFiles).toEqual({ map: ['src/b.ts'], flow: ['gen/a.ts', 'src/b.ts'] });
  });

  it('unknown --matched rule: reported with toJudge, no final, exit 0', async () => {
    const { out, err, code } = await run(tmp, ['--files', 'a.txt', '--matched', 'nope,behaviour-flow']);
    expect(err).toBe('');
    expect(code).toBeUndefined();
    const result = JSON.parse(out);
    expect(result.unknownMatched).toEqual(['nope']);
    expect(result.final).toBeUndefined();
    expect(result.toJudge.map((t: { rule: string }) => t.rule)).toEqual(['related-files', 'behaviour-flow']);
  });

  it('useBuiltinRules false: built-in names in --matched come back unknown with the repo rules to judge', async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, '.codechart.yaml'), 'useBuiltinRules: false\nrules:\n  - name: api\n    when: "an endpoint changed"\n');
    const result = JSON.parse((await run(repo, ['--files', 'a.txt', '--matched', 'related-files'])).out);
    expect(result.unknownMatched).toEqual(['related-files']);
    expect(result.toJudge).toEqual([{ rule: 'api', diagram: 'map', when: 'an endpoint changed', output: 'auto', context: 'short' }]);
    expect(result.final).toBeUndefined();
  });

  it('final present and toJudge omitted when no plain-language rules exist', async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, '.codechart.yaml'), 'useBuiltinRules: false\nrules:\n  - name: db\n    paths: ["db/**"]\n');
    const result = JSON.parse((await run(repo, ['--files', 'db/x.sql'])).out);
    expect(Object.keys(result)).toEqual(['pathMatches', 'final']);
    expect(result.final.map.rules).toEqual(['db']);
  });

  it('empty --matched still returns the final decision', async () => {
    const { out, err } = await run(tmp, ['--files', 'migrations/1.sql', '--matched', '']);
    expect(err).toBe('');
    expect(JSON.parse(out).final).toEqual({
      map: { draw: true, output: 'auto', context: 'short', rules: ['migrations'] },
      flow: { draw: false, output: 'none', rules: [] },
    });
  });

  it('built-in behaviour-flow is judged as a flow rule and fills final.flow', async () => {
    const { out } = await run(tmp, ['--files', 'src/a.ts', '--matched', 'behaviour-flow']);
    expect(JSON.parse(out).final).toEqual({
      map: { draw: false, output: 'none', context: 'short', rules: [] },
      flow: { draw: true, output: 'auto', rules: ['behaviour-flow'] },
    });
  });

  it('unknown option exits 2', async () => {
    const { code } = await run(tmp, ['--bogus']);
    expect(code).toBe(2);
  });

  it('--help exits 0', async () => {
    const { out, code } = await run(tmp, ['--help']);
    expect(out).toMatch(/Usage/);
    expect(code).toBe(0);
  });

  it('--git keeps paths with spaces intact', async () => {
    const repo = makeRepo();
    mkdirSync(join(repo, 'migrations'));
    writeFileSync(join(repo, 'migrations', 'my file.sql'), 'x');
    const result = JSON.parse((await run(repo, ['--git'])).out);
    expect(result.pathMatches[0].rule).toBe('migrations');
    expect(result.pathMatches[0].files).toEqual(['migrations/my file.sql']);
  });

  it('--git from a subdirectory yields root-relative paths', async () => {
    const repo = makeRepo();
    mkdirSync(join(repo, 'migrations'));
    writeFileSync(join(repo, 'migrations', '1.sql'), 'x');
    const result = JSON.parse((await run(join(repo, 'migrations'), ['--git'])).out);
    expect(result.pathMatches[0].rule).toBe('migrations');
    expect(result.pathMatches[0].files).toEqual(['migrations/1.sql']);
  });
});
