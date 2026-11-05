import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeRecord } from '../../src/commands/hook-record.js';
import { currentVersion } from '../../src/update/check.js';
import { makeSandbox, removeSandbox, repoFromTemplate, runCli, type Sandbox } from '../helpers/sandbox.js';

let sb: Sandbox;
const PIN = `codechart@${currentVersion()}`;

beforeEach(() => {
  sb = makeSandbox('ocinstall', { git: 'init' });
  mkdirSync(join(sb.home, '.config', 'opencode'), { recursive: true });
});

afterEach(() => removeSandbox(sb.tmp));

const dir = () => join(sb.home, '.config', 'opencode');
const json = () => join(dir(), 'opencode.json');
const jsonc = () => join(dir(), 'opencode.jsonc');
const norm = (s: string) => s.split(sb.home).join('~').replaceAll('\\', '/');
const run = async (args: string[], extra: Parameters<typeof runCli>[0] = {}) => {
  const bin = join(sb.tmp, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'codechart'), '#!/bin/sh\n');
  chmodSync(join(bin, 'codechart'), 0o755);
  const r = await runCli({ cwd: sb.repo, home: sb.home, env: { PATH: bin }, ...extra }, args);
  return { ...r, out: norm(r.out), err: norm(r.err) };
};
const plugins = (file = json()) => (JSON.parse(readFileSync(file, 'utf8')) as { plugins: unknown[] }).plugins;

describe('install-skill: OpenCode plugin', () => {
  it('pins the current version in a new opencode.json by default', async () => {
    const r = await run(['install-skill', '--agent', 'opencode']);
    expect(r.out).toContain(`plugin added: ${PIN} in ~/.config/opencode/opencode.json\n`);
    expect(JSON.parse(readFileSync(json(), 'utf8'))).toEqual({ $schema: 'https://opencode.ai/config.json', plugins: [PIN] });
    expect((await run(['install-skill', '--agent', 'opencode'])).out).toContain(`plugin already ${PIN} in`);
  });

  it('edits an existing opencode.jsonc in place, keeping comments and settings', async () => {
    writeFileSync(jsonc(), '// mine\n{\n  "model": "a/b", // pick\n  "plugins": ["x@1"]\n}\n');
    await run(['install-skill', '--agent', 'opencode']);
    expect(readFileSync(jsonc(), 'utf8')).toBe(`// mine\n{\n  "model": "a/b", // pick\n  "plugins": ["x@1", "${PIN}"]\n}\n`);
    expect(existsSync(json())).toBe(false);
  });

  it('replaces an older pin and one in the legacy plugin key instead of adding another', async () => {
    writeFileSync(json(), '{ "plugin": ["codechart@0.0.1"], "plugins": ["x"] }');
    const r = await run(['install-skill', '--agent', 'opencode']);
    expect(r.out).toContain(`plugin updated: ${PIN}`);
    expect(JSON.parse(readFileSync(json(), 'utf8'))).toEqual({ plugin: [PIN], plugins: ['x'] });
  });

  it('--no-plugin skips it; --plugin alone adds only the plugin; other agents never get it', async () => {
    await run(['install-skill', '--agent', 'opencode', '--no-plugin']);
    expect(existsSync(json())).toBe(false);
    const only = await run(['install-skill', '--agent', 'opencode', '--plugin']);
    expect(only.out).not.toContain('reminder');
    expect(plugins()).toEqual([PIN]);
    rmSync(json());
    mkdirSync(join(sb.home, '.claude'));
    await run(['install-skill', '--agent', 'claude', '--plugin']);
    expect(existsSync(json())).toBe(false);
  });

  it('a config it cannot parse is reported and left alone, with the rest installed', async () => {
    writeFileSync(json(), '{ "plugins": [');
    const r = await run(['install-skill', '--agent', 'opencode']);
    expect(r.err).toContain('plugin: ');
    expect(r.err).toContain('not valid JSON');
    expect(r.code).toBe(1);
    expect(readFileSync(json(), 'utf8')).toBe('{ "plugins": [');
    expect(r.out).toContain('installed for OpenCode');
  });
});

describe('update refreshes the pin', () => {
  it('rewrites an old pin, leaves an absent or current one alone', async () => {
    writeFileSync(json(), '{ "plugins": ["codechart@0.0.1"] }');
    const r = await run(['update', '--skills-only']);
    expect(r.out).toContain(`plugin updated: ${PIN} in ~/.config/opencode/opencode.json\n`);
    expect(plugins()).toEqual([PIN]);
    expect((await run(['update', '--skills-only'])).out).not.toContain('plugin');
    writeFileSync(json(), '{ "plugins": ["x"] }');
    await run(['update', '--skills-only']);
    expect(plugins()).toEqual(['x']);
  });
});

describe('uninstall --plugin', () => {
  it('removes only the plugin, or everything with no flags', async () => {
    await run(['install-skill', '--agent', 'opencode']);
    const only = await run(['uninstall', '--plugin']);
    expect(only.out).toBe('removed plugin: ~/.config/opencode/opencode.json\n');
    expect(plugins()).toEqual([]);
    expect(existsSync(join(dir(), 'AGENTS.md'))).toBe(true);
    await run(['install-skill', '--agent', 'opencode']);
    expect((await run(['uninstall', '--hook'])).out).toBe('nothing to remove\n');
    const all = await run(['uninstall']);
    expect(all.out).toContain('removed plugin:');
    expect(plugins()).toEqual([]);
  });
});

describe('doctor: OpenCode plugin', () => {
  const plugin = async () => (await run(['doctor'])).out.split('\n').find((l) => l.includes('plugin:'));

  it('✓ when pinned to this version, ⚠ when not added, ✗ for another version', async () => {
    await run(['install-skill', '--agent', 'opencode', '--no-plugin']);
    expect(await plugin()).toBe(`  ⚠ plugin: not added to ~/.config/opencode/opencode.json: run codechart install-skill --agent opencode --plugin`);
    await run(['install-skill', '--agent', 'opencode']);
    expect(await plugin()).toBe(`  ✓ plugin: ${PIN} in ~/.config/opencode/opencode.json`);
    writeFileSync(json(), '{ "plugins": ["codechart@0.0.1"] }');
    expect(await plugin()).toBe(`  ✗ plugin: pinned to 0.0.1, this codechart is ${currentVersion()} in ~/.config/opencode/opencode.json: run codechart install-skill --agent opencode`);
    writeFileSync(json(), '{ "plugins": ["codechart"] }');
    expect(await plugin()).toContain('✗ plugin: not pinned');
    writeFileSync(json(), '{ nope');
    expect(await plugin()).toContain('✗ plugin: ');
  });

  it('--fix repairs a ✗ pin but only names a missing plugin', async () => {
    await run(['install-skill', '--agent', 'opencode', '--no-plugin']);
    const missing = await run(['doctor', '--fix']);
    expect(missing.out).toContain('not added (opt-in): codechart install-skill --agent opencode --plugin\n');
    expect(existsSync(json())).toBe(false);
    writeFileSync(json(), '{ "plugins": ["codechart@0.0.1"] }');
    const r = await run(['doctor', '--fix']);
    expect(r.out).toContain(`plugin updated: ${PIN}`);
    expect(plugins()).toEqual([PIN]);
    expect(await plugin()).toContain('✓ plugin');
  });

  it('no "no hook yet" warning for OpenCode any more', async () => {
    await run(['install-skill', '--agent', 'opencode']);
    expect((await run(['doctor'])).out).not.toContain('no codechart hook for OpenCode');
  });
});

describe('doctor --last for OpenCode', () => {
  beforeEach(() => repoFromTemplate(sb.repo));

  const record = (r: Partial<Parameters<typeof writeRecord>[1]>) =>
    writeRecord(join(sb.home, '.cache', 'codechart', 'turns'), { at: '2026-11-05T10:00:00.000Z', root: sb.repo, session: 'ses_1', agent: 'opencode', ...r });

  it('without the plugin or hooks: points at both fixes', async () => {
    const r = await run(['doctor', '--last']);
    expect(r.out).toContain('supports Claude Code and OpenCode');
  });

  it('with the plugin: no record points at restarting OpenCode; a record is explained as OpenCode', async () => {
    await run(['install-skill', '--agent', 'opencode']);
    expect((await run(['doctor', '--last'])).out).toContain('OpenCode loads plugins at startup');
    record({ decision: 'nudged', files: ['a.ts', 'b.ts', 'c.ts'] });
    const r = await run(['doctor', '--last']);
    expect(r.out).toContain('session ses_1 (OpenCode)');
    expect(r.out).toContain('Decision: nudged');
    record({ decision: undefined, pendingAt: '2026-11-05T11:00:00.000Z' });
    expect((await run(['doctor', '--last'])).out).toContain('the plugin left no decision');
  });
});

describe('OpenCode 2 guard', () => {
  const tools = {
    v1: (c: string) => {
      if (c === 'opencode') return 'opencode 1.18.29\n';
      throw new Error('x');
    },
    gone: () => {
      throw new Error('ENOENT');
    },
    junk: (c: string) => {
      if (c === 'opencode') return 'hello\n';
      throw new Error('x');
    },
  };
  const OLD = '{ "plugins": ["codechart@0.0.1"] }';

  it('install-skill leaves opencode.json alone on OpenCode 1, when not found, or when unreadable', async () => {
    const expected = { v1: 'found 1.x', gone: 'not found', junk: 'not found' } as const;
    for (const k of ['v1', 'gone', 'junk'] as const) {
      const r = await run(['install-skill', '--agent', 'opencode'], { tool: tools[k] });
      expect(r.out).toContain(`OpenCode plugin skipped: needs OpenCode 2 (${expected[k]})\n`);
      expect(existsSync(json())).toBe(false);
      expect(r.code).toBeUndefined();
    }
  });

  it('falls back to ~/.opencode/bin/opencode when PATH has none', async () => {
    const seen: string[] = [];
    await run(['install-skill', '--agent', 'opencode'], {
      tool: (c) => {
        seen.push(c);
        if (c === 'opencode') throw new Error('ENOENT');
        return 'opencode v2.2.5';
      },
    });
    expect(seen[1]).toBe(join(sb.home, '.opencode', 'bin', 'opencode'));
    expect(plugins()).toEqual([PIN]);
  });

  it('update does not rewrite an old pin on OpenCode 1', async () => {
    writeFileSync(json(), OLD);
    const r = await run(['update', '--skills-only'], { tool: tools.v1 });
    expect(r.out).toContain('OpenCode plugin skipped: needs OpenCode 2 (found 1.x)');
    expect(readFileSync(json(), 'utf8')).toBe(OLD);
  });

  it('doctor shows a ⚠, not a ✗, and --fix leaves the file alone', async () => {
    writeFileSync(json(), OLD);
    const d = await run(['doctor', '--fix'], { tool: tools.v1 });
    expect(d.out).toContain('⚠ plugin: skipped, needs OpenCode 2 (found 1.x)');
    expect(d.out).not.toContain('✗ plugin');
    expect(readFileSync(json(), 'utf8')).toBe(OLD);
    rmSync(json());
    expect((await run(['doctor'], { tool: tools.gone })).out).toContain('⚠ plugin: skipped, needs OpenCode 2 (not found)');
  });

  it('a pin that is already current stays ✓ on any OpenCode', async () => {
    writeFileSync(json(), `{ "plugins": ["${PIN}"] }`);
    expect((await run(['doctor'], { tool: tools.v1 })).out).toContain(`✓ plugin: ${PIN}`);
  });

  it('uninstall removes an existing entry whatever OpenCode is', async () => {
    writeFileSync(json(), OLD);
    const r = await run(['uninstall', '--plugin'], { tool: tools.v1 });
    expect(r.out).toContain('removed plugin:');
    expect(plugins()).toEqual([]);
  });
});
