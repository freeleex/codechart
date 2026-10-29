import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram, runProgram } from '../../src/program.js';

let tmp: string;
let home: string;
let repo: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' }).trim();

function commit(file: string, msg = file): string {
  mkdirSync(join(repo, file, '..'), { recursive: true });
  writeFileSync(join(repo, file), msg);
  git('add', '.');
  git('commit', '-q', '-m', msg);
  return git('rev-parse', 'HEAD');
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-check-eff-'));
  home = join(tmp, 'home');
  repo = join(tmp, 'repo');
  mkdirSync(home);
  mkdirSync(repo);
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  git('config', 'commit.gpgsign', 'false');
  process.exitCode = undefined;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.exitCode = undefined;
});

async function check(...args: string[]) {
  let out = '';
  let err = '';
  const program = buildProgram({ cwd: repo, home, env: {}, stdout: (s) => (out += s), stderr: (s) => (err += s) });
  await runProgram(program, ['check', ...args], 'user');
  return { out, err, code: process.exitCode, json: out ? JSON.parse(out) : undefined };
}

const repoConfig = (yaml: string) => writeFileSync(join(repo, '.codechart.yaml'), yaml);
const files = (json: { pathMatches?: { files: string[] }[] }) => (json.pathMatches ?? []).flatMap((m) => m.files).sort();
const catchAll = 'rules:\n  - name: any\n    paths: ["**"]\n';

describe('check: toJudge omitted when it is the built-in set', () => {
  it('omitted with no config, names left so the agent still judges them', async () => {
    const r = await check('--files', 'migrations/1.sql');
    expect(r.json.toJudge).toBeUndefined();
    expect(r.json.judgeBuiltins).toEqual(['related-files', 'behaviour-flow']);
    expect(r.json.pathMatches[0].rule).toBe('migrations');
    expect((await check('--files', 'a.ts')).json).toEqual({ judgeBuiltins: ['related-files', 'behaviour-flow'] });
  });

  it('no judgeBuiltins once final is there or toJudge is printed', async () => {
    expect((await check('--files', 'a.ts', '--matched', 'related-files')).json.judgeBuiltins).toBeUndefined();
    expect((await check('--files', 'a.ts', '--matched', 'nope')).json.judgeBuiltins).toBeUndefined();
    repoConfig('rules:\n  - name: api\n    when: "an endpoint changed"\n');
    expect((await check('--files', 'a.ts')).json.judgeBuiltins).toBeUndefined();
  });

  it.each([
    ['a repo rule', 'rules:\n  - name: api\n    when: "an endpoint changed"\n'],
    ['a reworded built-in', 'rules:\n  - name: related-files\n    when: "any two files changed"\n'],
    ['defaults.flows always', 'defaults:\n  flows: always\n'],
    ['defaults.flows request', 'defaults:\n  flows: request\n'],
    ['defaults.output web', 'defaults:\n  output: web\n'],
    ['defaults.context full', 'defaults:\n  context: full\n'],
    ['built-ins off with a repo rule', 'useBuiltinRules: false\nrules:\n  - name: api\n    when: "x"\n'],
  ])('kept with %s', async (_, yaml) => {
    repoConfig(yaml);
    expect((await check('--files', 'a.ts')).json.toJudge.length).toBeGreaterThan(0);
  });

  it('kept with unknownMatched so the agent can rejudge', async () => {
    const r = await check('--files', 'a.ts', '--matched', 'nope');
    expect(r.json.unknownMatched).toEqual(['nope']);
    expect(r.json.toJudge.map((t: { rule: string }) => t.rule)).toEqual(['related-files', 'behaviour-flow']);
  });

  it('entries carry output and context', async () => {
    repoConfig('defaults:\n  context: full\n');
    expect((await check('--files', 'a.ts')).json.toJudge).toEqual([
      { rule: 'related-files', diagram: 'map', when: 'more than 2 changed files depend on each other', output: 'auto', context: 'full' },
      expect.objectContaining({ rule: 'behaviour-flow', diagram: 'flow', output: 'auto' }),
    ]);
  });
});

describe('check: git selection flags', () => {
  beforeEach(() => repoConfig(catchAll));

  it('--commit lists one commit, the root commit included', async () => {
    const root = commit('a.txt');
    const second = commit('src/b.txt');
    commit('c.txt');
    expect(files((await check('--commit', second)).json)).toEqual(['src/b.txt']);
    expect(files((await check('--commit', root)).json)).toEqual(['.codechart.yaml', 'a.txt']);
    expect(files((await check('--commit', 'HEAD~1')).json)).toEqual(['src/b.txt']);
  });

  it('--commit on a merge compares with the first parent', async () => {
    commit('a.txt');
    const main = git('rev-parse', '--abbrev-ref', 'HEAD');
    git('checkout', '-q', '-b', 'feature');
    commit('feature.txt');
    git('checkout', '-q', main);
    commit('main.txt');
    git('merge', '-q', '--no-ff', '-m', 'merge', 'feature');
    expect(files((await check('--commit', 'HEAD')).json)).toEqual(['feature.txt']);
  });

  it('--since lists files committed since base; --git adds uncommitted ones', async () => {
    const base = commit('a.txt');
    commit('b.txt');
    commit('c.txt');
    writeFileSync(join(repo, 'd.txt'), 'x');
    expect(files((await check('--since', base)).json)).toEqual(['b.txt', 'c.txt']);
    expect(files((await check('--since', base, '--git')).json)).toEqual(['b.txt', 'c.txt', 'd.txt']);
  });

  it('--since uses the merge base, --head picks another branch', async () => {
    commit('a.txt');
    const main = git('rev-parse', '--abbrev-ref', 'HEAD');
    git('checkout', '-q', '-b', 'feature');
    commit('feature.txt');
    git('checkout', '-q', main);
    commit('main.txt');
    expect(files((await check('--since', 'feature')).json)).toEqual(['main.txt']);
    expect(files((await check('--since', main, '--head', 'feature')).json)).toEqual(['feature.txt']);
  });

  it('a file named like the range is not taken as a path', async () => {
    const base = commit('a.txt');
    commit('b.txt');
    writeFileSync(join(repo, `${base}...HEAD`), 'x');
    expect(files((await check('--since', base)).json)).toEqual(['b.txt']);
  });

  it.each([
    [['--commit', '--output=x'], '--commit must not start with "-"'],
    [['--since', '-p'], '--since must not start with "-"'],
    [['--since', 'HEAD', '--head', '--all'], '--head must not start with "-"'],
    [['--commit', 'a\u0007b'], '--commit must not contain spaces, control or invisible characters'],
    [['--commit', 'a b'], '--commit must not contain spaces, control or invisible characters'],
    [['--since', 'a‮b'], '--since must not contain spaces, control or invisible characters'],
    [['--commit', 'x'.repeat(201)], '--commit is longer than 200 characters'],
    [['--commit', ''], '--commit is empty'],
  ])('rejects bad ref %j', async (args, message) => {
    commit('a.txt');
    const r = await check(...args);
    expect(r).toMatchObject({ code: 2, out: '', err: `codechart: ${message}\n` });
  });

  it('an unknown revision exits 2 with the git error', async () => {
    commit('a.txt');
    const commitErr = await check('--commit', 'nope');
    expect(commitErr).toMatchObject({ code: 2, out: '', err: 'codechart: --commit nope is not a commit\n' });
    const sinceErr = await check('--since', 'nope');
    expect(sinceErr.code).toBe(2);
    expect(sinceErr.err).toMatch(/^codechart: git diff failed: \S/);
  });

  it.each([
    [['--files', 'a', '--commit', 'HEAD']],
    [['--git', '--commit', 'HEAD']],
    [['--commit', 'HEAD', '--since', 'HEAD']],
    [['--files', 'a', '--since', 'HEAD']],
    [['--git', '--head', 'HEAD']],
    [['--git', '--since', 'HEAD', '--head', 'HEAD']],
    [['--files', '']],
    [['--files', ' , ']],
  ])('usage error %j', async (args) => {
    const r = await check(...args);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/--files|--head needs --since|--head compares another branch/);
  });

  it('outside a repo: not a git repository', async () => {
    rmSync(join(repo, '.git'), { recursive: true, force: true });
    expect(await check('--since', 'HEAD')).toMatchObject({ code: 2, err: 'codechart: not a git repository (use --files)\n' });
  });
});
