import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/load.js';
import { builtinRules } from '../../src/config/builtin-rules.js';

const BUILTIN_RULES = builtinRules('auto');

const fakeHome = vi.hoisted(() => ({ dir: '' }));
vi.mock('node:os', async (orig) => ({
  ...(await orig<typeof import('node:os')>()),
  homedir: () => fakeHome.dir,
}));

let home: string;
let repo: string;

function globalCfg(yaml: string, dir = join(home, '.config')) {
  mkdirSync(join(dir, 'codechart'), { recursive: true });
  writeFileSync(join(dir, 'codechart', 'config.yaml'), yaml);
}
function repoCfg(yaml: string) {
  writeFileSync(join(repo, '.codechart.yaml'), yaml);
}

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'codechart-cfg-'));
  home = join(base, 'home');
  repo = join(base, 'repo');
  mkdirSync(home, { recursive: true });
  fakeHome.dir = home;
  mkdirSync(join(repo, '.git'), { recursive: true });
});

describe('loadConfig', () => {
  it('no config files -> defaults + builtin rules', () => {
    const c = loadConfig({ cwd: repo, home, env: {} });
    expect(c.defaults).toEqual({ output: 'auto', context: 'short', flows: 'auto', terminalMaxNodes: 15 });
    expect(c.web).toEqual({
      outDir: join(home, '.cache', 'codechart'),
      theme: 'auto',
      minNodes: 8,
      keep: 20,
      maxAgeDays: 7,
      open: 'auto',
    });
    expect(c.useBuiltinRules).toBe(true);
    expect(c.rules).toEqual(BUILTIN_RULES);
  });

  it('repo defaults override global', () => {
    globalCfg('defaults:\n  output: cli\n  context: full\n  terminalMaxNodes: 5\n');
    repoCfg('defaults:\n  output: web\n');
    const c = loadConfig({ cwd: repo, home, env: {} });
    expect(c.defaults).toEqual({ output: 'web', context: 'full', flows: 'auto', terminalMaxNodes: 5 });
  });

  it.each(['foo', '5', 'true'])('scalar defaults (%s) gives a config error, not a crash', (v) => {
    repoCfg(`defaults: ${v}\n`);
    expect(() => loadConfig({ cwd: repo, home, env: {} })).toThrow('.codechart.yaml');
  });

  it('config rejects defaults.icons', () => {
    repoCfg('defaults:\n  icons: false\n');
    expect(() => loadConfig({ cwd: repo, home, env: {} })).toThrow('defaults.icons was removed');
  });

  it('rule order repo -> global -> builtin', () => {
    globalCfg('rules:\n  - name: g1\n    paths: ["a/**"]\n');
    repoCfg('rules:\n  - name: r1\n    paths: ["b/**"]\n  - name: r2\n    when: "x"\n');
    const c = loadConfig({ cwd: repo, home, env: {} });
    expect(c.rules.map((r) => r.name)).toEqual([
      'r1', 'r2', 'g1', ...BUILTIN_RULES.map((r) => r.name),
    ]);
  });

  it('duplicate rule name in one file throws', () => {
    repoCfg('rules:\n  - name: a\n    paths: ["x/**"]\n  - name: a\n    paths: ["y/**"]\n');
    expect(() => loadConfig({ cwd: repo, home, env: {} })).toThrow(/\.codechart\.yaml: rules\[1\]\.name: duplicate "a"/);
  });

  it('repo rule overrides builtin of same name', () => {
    repoCfg('rules:\n  - name: migrations\n    paths: ["only/**"]\n');
    const c = loadConfig({ cwd: repo, home, env: {} });
    const m = c.rules.filter((r) => r.name === 'migrations');
    expect(m).toEqual([{ name: 'migrations', paths: ['only/**'] }]);
    expect(c.rules).toHaveLength(BUILTIN_RULES.length);
  });

  it('useBuiltinRules:false in repo removes builtins', () => {
    repoCfg('useBuiltinRules: false\nrules:\n  - name: r1\n    paths: ["b/**"]\n');
    const c = loadConfig({ cwd: repo, home, env: {} });
    expect(c.useBuiltinRules).toBe(false);
    expect(c.rules.map((r) => r.name)).toEqual(['r1']);
  });

  it('rule with both paths and when -> error', () => {
    repoCfg('rules:\n  - name: bad\n    paths: ["a"]\n    when: "x"\n');
    expect(() => loadConfig({ cwd: repo, home, env: {} })).toThrow(
      'rules[0]: set exactly one of paths or when',
    );
  });

  it('XDG_CONFIG_HOME respected', () => {
    const xdg = join(home, 'xdg');
    globalCfg('rules:\n  - name: viaxdg\n    paths: ["a/**"]\n', xdg);
    const c = loadConfig({ cwd: repo, home, env: { XDG_CONFIG_HOME: xdg } });
    expect(c.rules[0]?.name).toBe('viaxdg');
  });

  it('no HOME env and no home param -> uses os.homedir()', () => {
    globalCfg('rules:\n  - name: viahomedir\n    paths: ["a/**"]\n');
    const c = loadConfig({ cwd: repo, env: {} });
    expect(c.rules[0]?.name).toBe('viahomedir');
  });

  it('empty home -> global config skipped', () => {
    fakeHome.dir = '';
    const c = loadConfig({ cwd: repo, env: {} });
    expect(c.rules).toEqual(BUILTIN_RULES);
  });

  it('relative XDG_CONFIG_HOME ignored', () => {
    globalCfg('rules:\n  - name: viahome\n    paths: ["a/**"]\n');
    const c = loadConfig({ cwd: repo, home, env: { XDG_CONFIG_HOME: 'rel/xdg' } });
    expect(c.rules[0]?.name).toBe('viahome');
  });

  it('finds repo root from nested cwd', () => {
    repoCfg('defaults:\n  output: none\n');
    const nested = join(repo, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    expect(loadConfig({ cwd: nested, home, env: {} }).defaults.output).toBe('none');
  });

  it('rejects unknown keys', () => {
    repoCfg('bogus: 1\n');
    expect(() => loadConfig({ cwd: repo, home, env: {} })).toThrow('bogus');
  });

  it('rejects the old defaults.outDir key', () => {
    repoCfg('defaults:\n  outDir: /tmp/x\n');
    expect(() => loadConfig({ cwd: repo, home, env: {} })).toThrow('outDir');
  });

  it("web.outDir '~/x' -> <home>/x, '~' -> <home>", () => {
    globalCfg('web:\n  outDir: ~/x\n');
    expect(loadConfig({ cwd: repo, home, env: {} }).web.outDir).toBe(join(home, 'x'));
    globalCfg('web:\n  outDir: "~"\n');
    expect(loadConfig({ cwd: repo, home, env: {} }).web.outDir).toBe(home);
  });

  it('relative web.outDir resolves against the home dir, not the repo', () => {
    globalCfg('web:\n  outDir: maps\n');
    const nested = join(repo, 'a');
    mkdirSync(nested, { recursive: true });
    expect(loadConfig({ cwd: nested, home, env: {} }).web.outDir).toBe(join(home, 'maps'));
  });

  it('repo web keys override global ones key by key', () => {
    globalCfg('web:\n  theme: dark\n  minNodes: 5\n');
    repoCfg('web:\n  minNodes: 4\n');
    expect(loadConfig({ cwd: repo, home, env: {} }).web).toMatchObject({ theme: 'dark', minNodes: 4, keep: 20, maxAgeDays: 7 });
  });

  it('rejects unknown web keys and bad web values', () => {
    repoCfg('web:\n  bogus: 1\n');
    expect(() => loadConfig({ cwd: repo, home, env: {} })).toThrow('bogus');
    repoCfg('web:\n  theme: neon\n');
    expect(() => loadConfig({ cwd: repo, home, env: {} })).toThrow('web.theme');
  });

  it("defaults.output accepts 'auto'", () => {
    globalCfg('defaults:\n  output: cli\n');
    repoCfg('defaults:\n  output: auto\n');
    expect(loadConfig({ cwd: repo, home, env: {} }).defaults.output).toBe('auto');
  });

  it('built-in behaviour-flow is a flow rule with output auto and the auto bar by default', () => {
    const rule = loadConfig({ cwd: repo, home, env: {} }).rules.find((r) => r.name === 'behaviour-flow');
    expect(rule).toEqual({
      name: 'behaviour-flow',
      diagram: 'flow',
      output: 'auto',
      when: 'the change adds or alters behaviour with at least 2 decisions or edge cases a reader would want to see',
    });
  });

  it('defaults.flows always lowers the behaviour-flow bar', () => {
    repoCfg('defaults:\n  flows: always\n');
    const rule = loadConfig({ cwd: repo, home, env: {} }).rules.find((r) => r.name === 'behaviour-flow');
    expect(rule?.when).toBe('the change adds or alters any behaviour with at least one decision');
  });

  it('defaults.flows request removes behaviour-flow, keeps the other built-ins', () => {
    globalCfg('defaults:\n  flows: request\n');
    const c = loadConfig({ cwd: repo, home, env: {} });
    expect(c.defaults.flows).toBe('request');
    expect(c.rules.map((r) => r.name)).toEqual(['migrations', 'orm-schema', 'related-files']);
  });

  it('useBuiltinRules false removes behaviour-flow whatever defaults.flows says', () => {
    repoCfg('useBuiltinRules: false\ndefaults:\n  flows: always\n');
    expect(loadConfig({ cwd: repo, home, env: {} }).rules).toEqual([]);
  });

  it('rejects bad defaults.flows and diagram values', () => {
    repoCfg('defaults:\n  flows: sometimes\n');
    expect(() => loadConfig({ cwd: repo, home, env: {} })).toThrow('defaults.flows');
    repoCfg('rules:\n  - name: a\n    diagram: chart\n    when: "x"\n');
    expect(() => loadConfig({ cwd: repo, home, env: {} })).toThrow('rules[0].diagram');
  });

  it('rejects context on a flow rule', () => {
    repoCfg('rules:\n  - name: a\n    diagram: flow\n    when: "x"\n    context: full\n');
    expect(() => loadConfig({ cwd: repo, home, env: {} })).toThrow('rules[0]: context applies only to map rules');
  });
});
