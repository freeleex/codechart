import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfigWithSources } from '../../src/config/load.js';
import { buildProgram, runProgram } from '../../src/program.js';
import { repoFolder } from '../../src/render/output-path.js';
import { pruneHtml } from '../../src/render/prune.js';

let tmp: string;
let home: string;
let repo: string;
let repoFile: string;
let globalFile: string;
const now = new Date(2026, 9, 28, 9, 5, 3);

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-outtrust-'));
  home = join(tmp, 'home');
  repo = join(tmp, 'repo');
  repoFile = join(repo, '.codechart.yaml');
  globalFile = join(home, '.config', 'codechart', 'config.yaml');
  mkdirSync(join(home, '.config', 'codechart'), { recursive: true });
  mkdirSync(join(repo, '.git'), { recursive: true });
  process.exitCode = undefined;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.exitCode = undefined;
});

async function run(args: string[]) {
  let out = '';
  let err = '';
  const program = buildProgram({ cwd: repo, home, env: {}, stdout: (s) => (out += s), stderr: (s) => (err += s), now: () => now, isTTY: false });
  await runProgram(program, args, 'user');
  return { out, err, code: process.exitCode };
}

const mapSpec = () => {
  const file = join(tmp, 'spec.json');
  const nodes = [{ id: 'a', label: 'a', kind: 'other', status: 'new', layer: 'l' }];
  writeFileSync(file, JSON.stringify({ title: 'T', kind: 'plan', nodes, edges: [] }));
  return file;
};

const victimFiles = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= 3; i++) writeFileSync(join(dir, `2020010${i}-000000-victim.html`), 'precious');
};

describe('web output settings are global-only (S-4)', () => {
  it('repo web.outDir/keep/maxAgeDays ignored with one warning line; HTML goes to the default dir', async () => {
    const evil = join(tmp, 'evil');
    writeFileSync(repoFile, `web:\n  outDir: ${evil}\n  keep: 999999\n  maxAgeDays: 99999\n  theme: dark\n`);
    const { err, code } = await run(['render', '--output', 'web', mapSpec()]);
    expect(code).toBeUndefined();
    expect(existsSync(evil)).toBe(false);
    expect(readdirSync(join(home, '.cache', 'codechart', repoFolder(repo)))).toHaveLength(1);
    expect(err).toBe(`codechart: ${repoFile}: web.outDir, web.keep, web.maxAgeDays are global-only; ignored\n`);
  });

  it('loaded config keeps global values and repo non-global-only ones', () => {
    writeFileSync(globalFile, 'web:\n  keep: 5\n');
    writeFileSync(repoFile, 'web:\n  keep: 3\n  outDir: /x\n  minNodes: 4\n');
    const warnings: string[] = [];
    const { config, sources } = loadConfigWithSources({ cwd: repo, home, env: {}, warn: (l) => warnings.push(l) });
    expect(config.web).toMatchObject({ keep: 5, minNodes: 4, maxAgeDays: 7, outDir: join(home, '.cache', 'codechart') });
    expect(sources['web.keep']).toBe(`global: ${globalFile}`);
    expect(warnings).toEqual([`${repoFile}: web.outDir, web.keep are global-only; ignored`]);
  });

  it('check and config warn too', async () => {
    writeFileSync(repoFile, 'web:\n  keep: 1\n');
    expect((await run(['check', '--files', 'a.py'])).err).toContain('web.keep are global-only');
    expect((await run(['config'])).err).toContain('web.keep are global-only');
  });

  it('codechart config marks them global-only', async () => {
    const { out } = await run(['config']);
    for (const key of ['web.outDir', 'web.keep', 'web.maxAgeDays']) {
      expect(out.split('\n').find((l) => l.startsWith(`${key}:`))).toMatch(/\(built-in; global-only\)$/);
    }
    expect(out.split('\n').find((l) => l.startsWith('web.theme:'))).toMatch(/\(built-in\)$/);
  });
});

describe('per-repo output folder must not be a symlink (S-4)', () => {
  it('symlinked <outDir>/<repo-hash> -> render refuses; victim files untouched', async () => {
    const out = join(tmp, 'out');
    const victim = join(tmp, 'victim');
    victimFiles(victim);
    mkdirSync(out);
    symlinkSync(victim, join(out, repoFolder(repo)));
    writeFileSync(globalFile, `web:\n  outDir: ${out}\n  keep: 1\n  maxAgeDays: 0\n`);
    const { err, code } = await run(['render', '--output', 'web', mapSpec()]);
    expect(code).toBe(1);
    expect(err).toBe(`codechart: ${join(out, repoFolder(repo))}: is a symlink; refusing to write\n`);
    expect(readdirSync(victim).sort()).toEqual(['20200101-000000-victim.html', '20200102-000000-victim.html', '20200103-000000-victim.html']);
  });

  it('pruneHtml on a symlinked folder deletes nothing', () => {
    const victim = join(tmp, 'victim');
    victimFiles(victim);
    symlinkSync(victim, join(tmp, 'link'));
    expect(pruneHtml(join(tmp, 'link'), { keep: 0, maxAgeDays: 0, now })).toEqual([]);
    expect(readdirSync(victim)).toHaveLength(3);
  });
});

describe('global outDir cannot be steered by the repo (S-4)', () => {
  it('relative global outDir + repo-shipped <outDir> symlink -> writes under home, victim untouched', async () => {
    const victim = join(tmp, 'victim');
    victimFiles(victim);
    symlinkSync(victim, join(repo, 'maps'));
    writeFileSync(globalFile, 'web:\n  outDir: maps\n  keep: 1\n  maxAgeDays: 0\n');
    const { code } = await run(['render', '--output', 'web', mapSpec()]);
    expect(code).toBeUndefined();
    expect(readdirSync(join(home, 'maps', repoFolder(repo)))).toHaveLength(1);
    expect(readdirSync(victim)).toHaveLength(3);
  });

  it('global outDir itself a symlink -> allowed, existing files untouched', async () => {
    const victim = join(tmp, 'victim');
    victimFiles(victim);
    const out = join(tmp, 'out');
    symlinkSync(victim, out);
    writeFileSync(globalFile, `web:\n  outDir: ${out}\n`);
    const { code } = await run(['render', '--output', 'web', mapSpec()]);
    expect(code).toBeUndefined();
    expect(readdirSync(join(victim, repoFolder(repo)))).toHaveLength(1);
    expect(readdirSync(victim)).toHaveLength(4);
  });

});
