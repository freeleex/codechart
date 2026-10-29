import { describe, expect, it } from 'vitest';
import type { Config } from '../../src/config/schema.js';
import { normalizePath, resolveRules, unionOutputs } from '../../src/rules/resolve.js';

const config: Config = {
  defaults: { output: 'both', context: 'short', flows: 'auto', terminalMaxNodes: 15 },
  web: { outDir: '/tmp/codechart', theme: 'auto', minNodes: 8, keep: 20, maxAgeDays: 7 },
  useBuiltinRules: false,
  rules: [
    { name: 'typeorm', paths: ['src/entities/**'], output: 'none' },
    { name: 'db', paths: ['**/entities/**', 'migrations/**'], output: 'both', context: 'full' },
    { name: 'fe', when: 'a frontend model changed', output: 'cli' },
  ],
};
const onlyPathRules: Config = { ...config, rules: config.rules.slice(0, 2) };

function db(result: ReturnType<typeof resolveRules>) {
  return result.pathMatches.find((m) => m.rule === 'db');
}

describe('resolveRules', () => {
  it('first match wins', () => {
    const r = resolveRules(config, ['src/entities/user.ts', 'lib/entities/a.ts']);
    expect(r.excludedFiles.map).toEqual(['src/entities/user.ts']);
    expect(db(r)?.files).toEqual(['lib/entities/a.ts']);
  });

  it('excluded files not in remainingFiles', () => {
    const r = resolveRules(config, ['src/entities/user.ts', 'migrations/1.sql', 'README.md']);
    expect(r.remainingFiles.map).toEqual(['migrations/1.sql', 'README.md']);
  });

  it('toJudge lists fe when matched undefined; final undefined', () => {
    const r = resolveRules(config, ['migrations/1.sql']);
    expect(r.toJudge).toEqual([{ rule: 'fe', diagram: 'map', when: 'a frontend model changed', output: 'cli', context: 'short' }]);
    expect(r.final).toBeUndefined();
  });

  it('toJudge carries output and context from defaults when the rule sets none', () => {
    const cfg: Config = { ...config, defaults: { ...config.defaults, context: 'full' }, rules: [{ name: 'x', when: 'w' }] };
    expect(resolveRules(cfg, []).toJudge).toEqual([{ rule: 'x', diagram: 'map', when: 'w', output: 'both', context: 'full' }]);
  });

  it('no plain rules -> final present', () => {
    const r = resolveRules(onlyPathRules, ['migrations/1.sql']);
    expect(r.toJudge).toEqual([]);
    expect(r.final?.map).toEqual({ draw: true, output: 'both', context: 'full', rules: ['db'] });
  });

  it("matched ['fe'] + db match -> both/full, rules db then fe", () => {
    const r = resolveRules(config, ['migrations/1.sql'], ['fe']);
    expect(r.final?.map).toEqual({ draw: true, output: 'both', context: 'full', rules: ['db', 'fe'] });
  });

  it('cli + web unions to both', () => {
    const cfg: Config = {
      ...config,
      rules: [
        { name: 'a', paths: ['a/**'], output: 'cli' },
        { name: 'b', paths: ['b/**'], output: 'web' },
      ],
    };
    expect(resolveRules(cfg, ['a/x', 'b/y']).final?.map.output).toBe('both');
  });

  it('plain rule alone contributes its output and context', () => {
    const r = resolveRules(config, ['README.md'], ['fe']);
    expect(r.final?.map).toEqual({ draw: true, output: 'cli', context: 'short', rules: ['fe'] });
  });

  it('inherits defaults when rule has no output/context', () => {
    const cfg: Config = { ...config, rules: [{ name: 'p', paths: ['p/**'] }] };
    expect(resolveRules(cfg, ['p/x']).pathMatches[0]).toMatchObject({ output: 'both', context: 'short' });
  });

  it('only none matches -> draw false', () => {
    const r = resolveRules(onlyPathRules, ['src/entities/user.ts']);
    expect(r.final?.map.draw).toBe(false);
    expect(r.final?.map.output).toBe('none');
  });

  it('nothing matches -> draw false', () => {
    const r = resolveRules(onlyPathRules, ['README.md']);
    expect(r.final).toEqual({
      map: { draw: false, output: 'none', context: 'short', rules: [] },
      flow: { draw: false, output: 'none', rules: [] },
    });
  });

  it('remainingFiles includes files no rule matched', () => {
    const r = resolveRules(config, ['README.md']);
    expect(r.remainingFiles).toEqual({ map: ['README.md'], flow: ['README.md'] });
  });

  it('normalizes backslashes and ./ before matching', () => {
    const r = resolveRules(onlyPathRules, ['.\\src\\entities\\a.ts', './migrations/x.sql']);
    expect(r.excludedFiles.map).toEqual(['src/entities/a.ts']);
    expect(db(r)?.files).toEqual(['migrations/x.sql']);
  });

  it('matches dotfiles', () => {
    const cfg: Config = { ...config, rules: [{ name: 'd', paths: ['**/*.sql'] }] };
    expect(resolveRules(cfg, ['.hidden/x.sql']).pathMatches).toHaveLength(1);
  });

  it('uses explicit root for absolute paths', () => {
    const r = resolveRules(onlyPathRules, ['/work/proj/src/entities/a.ts', '/work/proj/migrations/x.sql'], undefined, '/work/proj');
    expect(r.excludedFiles.map).toEqual(['src/entities/a.ts']);
    expect(db(r)?.files).toEqual(['migrations/x.sql']);
  });

  it('dedupes input files', () => {
    const r = resolveRules(onlyPathRules, ['migrations/x.sql', './migrations/x.sql']);
    expect(db(r)?.files).toEqual(['migrations/x.sql']);
  });

  it('final.rules lists plain rules in config order, deduped', () => {
    const cfg: Config = {
      ...config,
      rules: [
        { name: 'a', when: 'a' },
        { name: 'b', when: 'b' },
      ],
    };
    expect(resolveRules(cfg, [], ['b', 'a', 'b']).final?.map.rules).toEqual(['a', 'b']);
  });

  it('unknown matched name is reported and withholds final', () => {
    const r = resolveRules(config, [], ['x', 'fe']);
    expect(r.unknownMatched).toEqual(['x']);
    expect(r.final).toBeUndefined();
    expect(r.toJudge.map((t) => t.rule)).toContain('fe');
  });

  it('a map none rule does not exclude files from flow rules', () => {
    const cfg: Config = {
      ...config,
      rules: [
        { name: 'skip', paths: ['src/**'], output: 'none' },
        { name: 'api-flow', diagram: 'flow', paths: ['src/api/**'] },
        { name: 'behaviour', diagram: 'flow', when: 'behaviour changed', output: 'auto' },
      ],
    };
    const r = resolveRules(cfg, ['src/api/x.ts']);
    expect(r.excludedFiles).toEqual({ map: ['src/api/x.ts'], flow: [] });
    expect(r.remainingFiles).toEqual({ map: [], flow: ['src/api/x.ts'] });
    expect(r.pathMatches).toEqual([
      { rule: 'skip', diagram: 'map', files: ['src/api/x.ts'], output: 'none', context: 'short' },
      { rule: 'api-flow', diagram: 'flow', files: ['src/api/x.ts'], output: 'both' },
    ]);
    expect(r.toJudge).toEqual([{ rule: 'behaviour', diagram: 'flow', when: 'behaviour changed', output: 'auto' }]);
    expect(resolveRules(cfg, ['src/api/x.ts'], ['behaviour']).final).toEqual({
      map: { draw: false, output: 'none', context: 'short', rules: [] },
      flow: { draw: true, output: 'both', rules: ['api-flow', 'behaviour'] },
    });
  });

  it('first match wins within a diagram type only', () => {
    const cfg: Config = {
      ...config,
      rules: [
        { name: 'm', paths: ['a/**'], output: 'cli' },
        { name: 'f1', diagram: 'flow', paths: ['a/**'], output: 'web' },
        { name: 'f2', diagram: 'flow', paths: ['a/**'], output: 'cli' },
      ],
    };
    const r = resolveRules(cfg, ['a/x']);
    expect(r.pathMatches.map((m) => m.rule)).toEqual(['m', 'f1']);
    expect(r.final).toEqual({
      map: { draw: true, output: 'cli', context: 'short', rules: ['m'] },
      flow: { draw: true, output: 'web', rules: ['f1'] },
    });
  });

  it('flow none rule excludes files only from flows', () => {
    const cfg: Config = {
      ...config,
      rules: [
        { name: 'nf', diagram: 'flow', paths: ['gen/**'], output: 'none' },
        { name: 'm', paths: ['gen/**'] },
      ],
    };
    const r = resolveRules(cfg, ['gen/a.ts']);
    expect(r.excludedFiles).toEqual({ map: [], flow: ['gen/a.ts'] });
    expect(r.final?.map.draw).toBe(true);
    expect(r.final?.flow.draw).toBe(false);
  });

  it('flow plain rule does not contribute to the map', () => {
    const cfg: Config = { ...config, rules: [{ name: 'b', diagram: 'flow', when: 'x', output: 'web' }] };
    expect(resolveRules(cfg, ['a.ts'], ['b']).final).toEqual({
      map: { draw: false, output: 'none', context: 'short', rules: [] },
      flow: { draw: true, output: 'web', rules: ['b'] },
    });
  });

  it('path rule name in matched throws', () => {
    expect(() => resolveRules(config, [], ['db'])).toThrow('not a plain-language rule: db');
  });
});

describe('unionOutputs', () => {
  it.each([
    [['auto', 'cli'], 'auto'],
    [['auto', 'web'], 'both'],
    [['auto', 'both'], 'both'],
    [['auto', 'none'], 'auto'],
    [['auto'], 'auto'],
    [['cli', 'web'], 'both'],
    [['none'], 'none'],
    [[], 'none'],
  ] as const)('%j -> %s', (outputs, expected) => {
    expect(unionOutputs([...outputs])).toBe(expected);
  });
});

describe('normalizePath', () => {
  const root = '/repo';
  it('converts backslashes and strips ./', () => {
    expect(normalizePath('.\\src\\a.ts', root)).toBe('src/a.ts');
    expect(normalizePath('./a/b.ts', root)).toBe('a/b.ts');
  });
  it('makes absolute path inside root relative', () => {
    expect(normalizePath('/repo/src/a.ts', root)).toBe('src/a.ts');
  });
  it('keeps absolute path outside root', () => {
    expect(normalizePath('/other/src/a.ts', root)).toBe('/other/src/a.ts');
    expect(normalizePath('/repository/a.ts', root)).toBe('/repository/a.ts');
  });
  it('strips windows drive-letter root, case-insensitive drive', () => {
    expect(normalizePath('C:\\repo\\src\\entities\\user.ts', 'C:\\repo')).toBe('src/entities/user.ts');
    expect(normalizePath('c:/repo/a.ts', 'C:/repo')).toBe('a.ts');
    expect(normalizePath('D:/other/a.ts', 'C:/repo')).toBe('D:/other/a.ts');
  });
  it('keeps in-root files named ..foo', () => {
    expect(normalizePath('/repo/..foo/a.ts', root)).toBe('..foo/a.ts');
    expect(normalizePath('/repo/..', root)).toBe('/repo/..');
  });
});
