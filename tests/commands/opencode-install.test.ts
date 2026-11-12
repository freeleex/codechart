import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeRecord } from '../../src/commands/hook-record.js';
import { pluginBlocker } from '../../src/commands/opencode-version.js';
import { makeSandbox, removeSandbox, repoFromTemplate, runCli, type Sandbox } from '../helpers/sandbox.js';

let sb: Sandbox;

beforeEach(() => {
  sb = makeSandbox('ocinstall', { git: 'init' });
  mkdirSync(join(sb.home, '.config', 'opencode'), { recursive: true });
});

afterEach(() => removeSandbox(sb.tmp));

const dir = () => join(sb.home, '.config', 'opencode');
const plugin = () => join(dir(), 'plugins', 'codechart.js');
const built = () => readFileSync(join(process.cwd(), 'dist', 'server.js'), 'utf8');
const norm = (s: string) => s.split(sb.home).join('~').replaceAll('\\', '/');
const run = async (args: string[], extra: Parameters<typeof runCli>[0] = {}) => {
  const bin = join(sb.tmp, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'codechart'), '#!/bin/sh\n');
  chmodSync(join(bin, 'codechart'), 0o755);
  const r = await runCli({ cwd: sb.repo, home: sb.home, env: { PATH: bin }, ...extra }, args);
  return { ...r, out: norm(r.out), err: norm(r.err) };
};
const OLD = '#!/usr/bin/env node\n/*! codechart OpenCode plugin: old */\nexport default {};\n';
const FOREIGN = '// my own plugin\nexport default {};\n';
const put = (text: string) => {
  mkdirSync(join(dir(), 'plugins'), { recursive: true });
  writeFileSync(plugin(), text);
};

describe('install-skill: OpenCode plugin', () => {
  it('copies the built plugin to the auto-loaded plugins folder, and says so when it is current', async () => {
    const r = await run(['install-skill', '--agent', 'opencode']);
    expect(r.out).toContain('installed for OpenCode plugin: ~/.config/opencode/plugins/codechart.js\n');
    expect(readFileSync(plugin(), 'utf8')).toBe(built());
    expect(existsSync(join(dir(), 'opencode.json'))).toBe(false);
    expect((await run(['install-skill', '--agent', 'opencode'])).out).toContain('up to date for OpenCode plugin:');
  });

  it('honours XDG_CONFIG_HOME like OpenCode does', async () => {
    const xdg = join(sb.tmp, 'xdg');
    mkdirSync(xdg);
    await run(['install-skill', '--agent', 'opencode'], { env: { PATH: join(sb.tmp, 'bin'), XDG_CONFIG_HOME: xdg } });
    expect(readFileSync(join(xdg, 'opencode', 'plugins', 'codechart.js'), 'utf8')).toBe(built());
    expect(existsSync(plugin())).toBe(false);
  });

  it('refreshes an older copy of ours without --force', async () => {
    put(OLD);
    const r = await run(['install-skill', '--agent', 'opencode']);
    expect(r.out).toContain('updated for OpenCode plugin:');
    expect(readFileSync(plugin(), 'utf8')).toBe(built());
  });

  it('leaves a foreign file of that name alone unless --force', async () => {
    put(FOREIGN);
    const r = await run(['install-skill', '--agent', 'opencode']);
    expect(r.out).toContain('already installed for OpenCode plugin:');
    expect(r.out).toContain('--force');
    expect(readFileSync(plugin(), 'utf8')).toBe(FOREIGN);
    await run(['install-skill', '--agent', 'opencode', '--force']);
    expect(readFileSync(plugin(), 'utf8')).toBe(built());
  });

  it('--no-plugin skips it; --plugin alone adds only the plugin; other agents never get it', async () => {
    await run(['install-skill', '--agent', 'opencode', '--no-plugin']);
    expect(existsSync(plugin())).toBe(false);
    const only = await run(['install-skill', '--agent', 'opencode', '--plugin']);
    expect(only.out).not.toContain('reminder');
    expect(existsSync(plugin())).toBe(true);
    await run(['uninstall', '--plugin']);
    mkdirSync(join(sb.home, '.claude'));
    await run(['install-skill', '--agent', 'claude', '--plugin']);
    expect(existsSync(plugin())).toBe(false);
  });

  it('does not write through a symlink at the plugin path', async () => {
    mkdirSync(join(dir(), 'plugins'), { recursive: true });
    const real = join(sb.tmp, 'dotfiles.js');
    writeFileSync(real, FOREIGN);
    symlinkSync(real, plugin());
    await run(['install-skill', '--agent', 'opencode']);
    expect(readFileSync(real, 'utf8')).toBe(FOREIGN);
  });
});

describe('update refreshes the copy', () => {
  it('rewrites an older copy, leaves an absent or current one alone', async () => {
    expect((await run(['update', '--skills-only'])).out).not.toContain('plugin');
    expect(existsSync(plugin())).toBe(false);
    put(OLD);
    const r = await run(['update', '--skills-only']);
    expect(r.out).toContain('updated for OpenCode plugin:');
    expect(readFileSync(plugin(), 'utf8')).toBe(built());
    expect((await run(['update', '--skills-only'])).out).not.toContain('plugin');
    put(FOREIGN);
    await run(['update', '--skills-only']);
    expect(readFileSync(plugin(), 'utf8')).toBe(FOREIGN);
  });
});

describe('uninstall --plugin', () => {
  it('removes only our copy, or everything with no flags; a foreign file stays', async () => {
    await run(['install-skill', '--agent', 'opencode']);
    const only = await run(['uninstall', '--plugin']);
    expect(only.out).toBe('removed plugin: ~/.config/opencode/plugins/codechart.js\n');
    expect(existsSync(plugin())).toBe(false);
    expect(existsSync(join(dir(), 'AGENTS.md'))).toBe(true);
    await run(['install-skill', '--agent', 'opencode']);
    expect((await run(['uninstall', '--hook'])).out).toBe('nothing to remove\n');
    expect((await run(['uninstall'])).out).toContain('removed plugin:');
    put(FOREIGN);
    expect((await run(['uninstall', '--plugin'])).out).toContain('not the codechart plugin');
    expect(readFileSync(plugin(), 'utf8')).toBe(FOREIGN);
  });
});

describe('doctor: OpenCode plugin', () => {
  const line = async (args = ['doctor']) => (await run(args)).out.split('\n').find((l) => l.includes('plugin:'));

  it('✓ current, ⚠ not added, ✗ outdated, ✗ foreign', async () => {
    await run(['install-skill', '--agent', 'opencode', '--no-plugin']);
    expect(await line()).toBe('  ⚠ plugin: not added (~/.config/opencode/plugins/codechart.js): run codechart install-skill --agent opencode --plugin');
    await run(['install-skill', '--agent', 'opencode']);
    expect(await line()).toBe('  ✓ plugin: ~/.config/opencode/plugins/codechart.js (current)');
    put(OLD);
    expect(await line()).toBe('  ✗ plugin: outdated at ~/.config/opencode/plugins/codechart.js: run codechart install-skill --agent opencode');
    put(FOREIGN);
    expect(await line()).toContain('✗ plugin: ~/.config/opencode/plugins/codechart.js is not the codechart plugin');
  });

  it('--fix refreshes an outdated copy, only names a missing one, never touches a foreign one', async () => {
    await run(['install-skill', '--agent', 'opencode', '--no-plugin']);
    const missing = await run(['doctor', '--fix']);
    expect(missing.out).toContain('not added (opt-in): codechart install-skill --agent opencode --plugin\n');
    expect(existsSync(plugin())).toBe(false);
    put(OLD);
    const r = await run(['doctor', '--fix']);
    expect(r.out).toContain('updated for OpenCode plugin:');
    expect(readFileSync(plugin(), 'utf8')).toBe(built());
    put(FOREIGN);
    await run(['doctor', '--fix']);
    expect(readFileSync(plugin(), 'utf8')).toBe(FOREIGN);
  });
});

describe('OpenCode 2 guard', () => {
  const v1 = (c: string) => {
    if (c === 'opencode') return 'opencode 1.18.29\n';
    throw new Error('x');
  };
  const gone = () => {
    throw new Error('ENOENT');
  };
  const junk = (c: string) => {
    if (c === 'opencode') return 'hello\n';
    throw new Error('x');
  };

  it('install-skill copies nothing on OpenCode 1, when not found, or when unreadable', async () => {
    const cases = [
      [v1, 'found 1.x'],
      [gone, 'not found'],
      [junk, 'not found'],
    ] as const;
    for (const [tool, why] of cases) {
      const r = await run(['install-skill', '--agent', 'opencode'], { tool });
      expect(r.out).toContain(`OpenCode plugin skipped: needs OpenCode 2 (${why})\n`);
      expect(existsSync(plugin())).toBe(false);
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
    expect(existsSync(plugin())).toBe(true);
  });

  it('on Windows the bare name runs as the .exe from an absolute PATH entry', () => {
    const seen: string[][] = [];
    const blocker = pluginBlocker({ stdout: () => {}, stderr: () => {} }, sb.home, {
      platform: 'win32',
      env: { PATH: '.;C:\\Tools' },
      exists: (p) => p === 'C:\\Tools\\opencode.exe',
      exec: (file, args) => {
        seen.push([file, ...args]);
        return 'opencode v2.2.5\n';
      },
    });
    expect(blocker).toBeUndefined();
    expect(seen).toEqual([['C:\\Tools\\opencode.exe', '--version']]);
  });

  it('on Windows a bare name off PATH is not found; the absolute fallback runs as it is', () => {
    const seen: string[] = [];
    const blocker = pluginBlocker({ stdout: () => {}, stderr: () => {} }, sb.home, {
      platform: 'win32',
      env: { PATH: '.;C:\\nope' },
      exists: () => false,
      exec: (file) => {
        seen.push(file);
        throw new Error('gone');
      },
    });
    expect(blocker).toBe('needs OpenCode 2 (not found)');
    expect(seen).toEqual([join(sb.home, '.opencode', 'bin', 'opencode')]);
  });

  it('update leaves an older copy alone on OpenCode 1', async () => {
    put(OLD);
    expect((await run(['update', '--skills-only'], { tool: v1 })).out).toContain('OpenCode plugin skipped: needs OpenCode 2 (found 1.x)');
    expect(readFileSync(plugin(), 'utf8')).toBe(OLD);
  });

  it('doctor shows a ⚠, not a ✗, for a missing or outdated copy, and --fix leaves it alone', async () => {
    put(OLD);
    const d = await run(['doctor', '--fix'], { tool: v1 });
    expect(d.out).toContain('⚠ plugin: skipped, needs OpenCode 2 (found 1.x)');
    expect(d.out).not.toContain('✗ plugin');
    expect(readFileSync(plugin(), 'utf8')).toBe(OLD);
    await run(['uninstall', '--plugin']);
    expect((await run(['doctor'], { tool: gone })).out).toContain('⚠ plugin: skipped, needs OpenCode 2 (not found)');
  });

  it('a current copy stays ✓ on any OpenCode, and uninstall removes ours whatever OpenCode is', async () => {
    await run(['install-skill', '--agent', 'opencode']);
    expect((await run(['doctor'], { tool: v1 })).out).toContain('✓ plugin:');
    expect((await run(['uninstall', '--plugin'], { tool: v1 })).out).toContain('removed plugin:');
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
