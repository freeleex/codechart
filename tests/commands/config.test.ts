import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtinRules } from '../../src/config/builtin-rules.js';
import { loadConfig, loadConfigWithSources } from '../../src/config/load.js';
import { configJsonSchema } from '../../src/config/schema.js';
import { buildProgram, runProgram } from '../../src/program.js';

let tmp: string;
let home: string;
let repo: string;
let globalFile: string;
let repoFile: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-config-'));
  home = join(tmp, 'home');
  repo = join(tmp, 'repo');
  globalFile = join(home, '.config', 'codechart', 'config.yaml');
  repoFile = join(repo, '.codechart.yaml');
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
  const program = buildProgram({ cwd: repo, home, env: {}, stdout: (s) => (out += s), stderr: (s) => (err += s) });
  await runProgram(program, ['config', ...args], 'user');
  return { out, err, code: process.exitCode };
}

const line = (out: string, prefix: string) => out.split('\n').find((l) => l.startsWith(prefix));

describe('loadConfigWithSources', () => {
  it('records the source of each value and rule', () => {
    writeFileSync(globalFile, 'web:\n  theme: dark\nrules:\n  - name: g1\n    paths: ["a/**"]\n');
    writeFileSync(repoFile, 'defaults:\n  context: full\nweb:\n  theme: light\nrules:\n  - name: r1\n    when: "x"\n');
    const { config, sources, ruleSources } = loadConfigWithSources({ cwd: repo, home, env: {} });
    expect(config).toEqual(loadConfig({ cwd: repo, home, env: {} }));
    expect(sources['defaults.context']).toBe(`repo: ${repoFile}`);
    expect(sources['defaults.output']).toBe('built-in');
    expect(sources['web.theme']).toBe(`repo: ${repoFile}`);
    expect(sources['useBuiltinRules']).toBe('built-in');
    expect(ruleSources).toEqual([`repo: ${repoFile}`, `global: ${globalFile}`, ...builtinRules('auto').map(() => 'built-in')]);
  });

  it('useBuiltinRules false is attributed to the file that set it', () => {
    writeFileSync(globalFile, 'useBuiltinRules: false\n');
    expect(loadConfigWithSources({ cwd: repo, home, env: {} }).sources['useBuiltinRules']).toBe(`global: ${globalFile}`);
  });
});

describe('codechart config', () => {
  it('config: repo sets terminalMaxNodes 10 -> line shows 10 and repo source; untouched keys show built-in', async () => {
    writeFileSync(repoFile, 'defaults:\n  terminalMaxNodes: 10\n');
    const { out, code } = await run([]);
    expect(code).toBeUndefined();
    expect(line(out, 'defaults.terminalMaxNodes:')).toBe(`defaults.terminalMaxNodes: 10  (repo: ${repoFile})`);
    expect(line(out, 'defaults.output:')).toBe('defaults.output: auto  (built-in)');
    expect(line(out, 'web.theme:')).toBe('web.theme: auto  (built-in)');
    expect(line(out, 'web.outDir:')).toBe(`web.outDir: ${join(home, '.cache', 'codechart')}  (built-in; global-only)`);
  });

  it('config lists rules repo -> global -> built-in with sources', async () => {
    writeFileSync(globalFile, 'rules:\n  - name: g1\n    paths: ["a/**", "b/**"]\n    output: web\n    context: full\n');
    writeFileSync(repoFile, 'rules:\n  - name: r1\n    when: "a model changed"\n');
    const { out } = await run([]);
    const rules = out.split('rules (evaluation order):\n')[1]!.trimEnd().split('\n');
    expect(rules).toEqual([
      `  r1  map  when: "a model changed"  auto  context: short  (repo: ${repoFile})`,
      `  g1  map  paths: a/**, b/**  web  context: full  (global: ${globalFile})`,
      `  migrations  map  paths: ${builtinRules('auto')[0]!.paths!.join(', ')}  auto  context: short  (built-in)`,
      `  orm-schema  map  paths: ${builtinRules('auto')[1]!.paths!.join(', ')}  auto  context: short  (built-in)`,
      `  related-files  map  when: "more than 2 changed files depend on each other"  auto  context: short  (built-in)`,
      `  behaviour-flow  flow  when: "the change adds or alters behaviour with at least 2 decisions or edge cases a reader would want to see"  auto  (built-in)`,
    ]);
  });

  it('defaults.flows shows its value and source while built-in rules are on', async () => {
    writeFileSync(repoFile, 'defaults:\n  flows: always\n');
    expect(line((await run([])).out, 'defaults.flows:')).toBe(`defaults.flows: always  (repo: ${repoFile})`);
  });

  it('defaults.flows is inactive when built-in rules are off', async () => {
    writeFileSync(repoFile, 'useBuiltinRules: false\n');
    expect(line((await run([])).out, 'defaults.flows:')).toBe('defaults.flows: inactive (built-in rules off)  (built-in)');
  });

  it('--json prints config, sources and ruleSources', async () => {
    writeFileSync(repoFile, 'defaults:\n  terminalMaxNodes: 10\n');
    const { out } = await run(['--json']);
    expect(JSON.parse(out)).toEqual(loadConfigWithSources({ cwd: repo, home, env: {} }));
  });

  it('invalid config -> error, exit 1', async () => {
    writeFileSync(repoFile, 'bogus: 1\n');
    const { err, code } = await run([]);
    expect(code).toBe(1);
    expect(err).toMatch(/^codechart: .*bogus/);
  });
});

describe('config.schema.json', () => {
  it('committed file matches the zod config schema (run npm run gen:config-schema)', () => {
    const committed = readFileSync(join(import.meta.dirname, '..', '..', 'config.schema.json'), 'utf8');
    expect(committed).toBe(JSON.stringify(configJsonSchema(), null, 2) + '\n');
  });
});
