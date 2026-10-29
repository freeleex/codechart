import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/load.js';
import { configJsonSchema } from '../../src/config/schema.js';
import { buildProgram, runProgram } from '../../src/program.js';
import { STEP_STATUSES } from '../../src/spec/flow.js';
import { STATUSES } from '../../src/spec/schema.js';

const root = join(import.meta.dirname, '..', '..');
const template = readFileSync(join(root, 'templates', 'codechart.yaml'), 'utf8');
const skill = readFileSync(join(root, 'skills', 'codechart', 'SKILL.md'), 'utf8');
const specGuide = readFileSync(join(root, 'skills', 'codechart', 'spec-guide.md'), 'utf8');
const flowGuide = readFileSync(join(root, 'skills', 'codechart', 'flow-guide.md'), 'utf8');

let tmp: string;
let home: string;
let repo: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-install-'));
  home = join(tmp, 'home');
  repo = join(tmp, 'repo');
  mkdirSync(home);
  mkdirSync(join(repo, '.git'), { recursive: true });
  process.exitCode = undefined;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.exitCode = undefined;
});

async function run(cwd: string, args: string[], picked?: number[] | 'cancel') {
  let out = '';
  let err = '';
  let shown: string[] = [];
  const choose =
    picked === undefined
      ? undefined
      : async (_: string, items: { label: string; hint: string }[]) => {
          shown = items.map((i) => `${i.label} ${i.hint}`);
          return picked === 'cancel' ? undefined : picked;
        };
  const program = buildProgram({ cwd, home, env: {}, choose, stdout: (s) => (out += s), stderr: (s) => (err += s) });
  await runProgram(program, args, 'user');
  return { out, err, code: process.exitCode, shown };
}

describe('codechart install-skill', () => {
  const target = () => join(home, '.claude', 'skills', 'codechart', 'SKILL.md');
  beforeEach(() => mkdirSync(join(home, '.claude')));

  it('install-skill writes file in temp HOME', async () => {
    const { out, code } = await run(repo, ['install-skill']);
    expect(code).toBeUndefined();
    expect(readFileSync(target(), 'utf8')).toBe(skill);
    expect(out).toBe(`agents: Claude Code\ninstalled for Claude Code: ${join(home, '.claude', 'skills', 'codechart')}\n`);
  });

  it('installs every file of the skill, so its links resolve', async () => {
    await run(repo, ['install-skill']);
    for (const f of ['spec-guide.md', 'flow-guide.md', 'example.md']) {
      expect(readFileSync(join(home, '.claude', 'skills', 'codechart', f), 'utf8')).toBe(
        readFileSync(join(root, 'skills', 'codechart', f), 'utf8'),
      );
    }
  });

  it('skips an existing install without overwriting it', async () => {
    mkdirSync(join(home, '.claude', 'skills', 'codechart'), { recursive: true });
    writeFileSync(target(), 'mine');
    const { out, code } = await run(repo, ['install-skill']);
    expect(code).toBeUndefined();
    expect(out).toContain(`already installed for Claude Code: ${join(home, '.claude', 'skills', 'codechart')} (--force to update)\n`);
    expect(readFileSync(target(), 'utf8')).toBe('mine');
  });

  it('skips a folder holding any skill file, writing nothing there', async () => {
    const dir = join(home, '.claude', 'skills', 'codechart');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'spec-guide.md'), 'mine');
    const { out, code } = await run(repo, ['install-skill']);
    expect(code).toBeUndefined();
    expect(out).toContain(`already installed for Claude Code: ${dir}`);
    expect(readFileSync(join(dir, 'spec-guide.md'), 'utf8')).toBe('mine');
    expect(existsSync(target())).toBe(false);
  });

  it('filesystem error -> codechart: message, exit 1', async () => {
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
    writeFileSync(join(home, '.claude', 'skills', 'codechart'), 'a file');
    const { err, code } = await run(repo, ['install-skill']);
    expect(code).toBe(1);
    expect(err).toMatch(/^codechart: \S.*\n$/);
  });

  it('--force overwrites', async () => {
    mkdirSync(join(home, '.claude', 'skills', 'codechart'), { recursive: true });
    writeFileSync(target(), 'mine');
    const { code } = await run(repo, ['install-skill', '--force']);
    expect(code).toBeUndefined();
    expect(readFileSync(target(), 'utf8')).toBe(skill);
  });
});

describe('codechart install-skill for other agents', () => {
  const skillAt = (...dir: string[]) => join(home, ...dir, 'codechart', 'SKILL.md');

  it('detects agents by their home folder and names them', async () => {
    mkdirSync(join(home, '.gemini'));
    mkdirSync(join(home, '.kiro'));
    const { out, code } = await run(repo, ['install-skill']);
    expect(code).toBeUndefined();
    expect(out.split('\n')[0]).toBe('agents: Gemini CLI, Kiro');
    expect(readFileSync(skillAt('.gemini', 'skills'), 'utf8')).toBe(skill);
    expect(readFileSync(skillAt('.kiro', 'skills'), 'utf8')).toBe(skill);
    expect(existsSync(join(home, '.claude'))).toBe(false);
  });

  it('installs once per folder: agents that also read a chosen folder are skipped', async () => {
    for (const d of ['.claude', '.cursor', '.codex', '.gemini']) mkdirSync(join(home, d));
    const { out } = await run(repo, ['install-skill']);
    expect(out).toContain(`installed for Claude Code, Cursor: ${join(home, '.claude', 'skills', 'codechart')}\n`);
    expect(out).toContain(`installed for Codex, Gemini CLI: ${join(home, '.agents', 'skills', 'codechart')}\n`);
    expect(existsSync(skillAt('.claude', 'skills'))).toBe(true);
    expect(existsSync(skillAt('.agents', 'skills'))).toBe(true);
    expect(existsSync(skillAt('.cursor', 'skills'))).toBe(false);
    expect(existsSync(skillAt('.gemini', 'skills'))).toBe(false);
  });

  it('--agent picks agents without detection, comma or space separated', async () => {
    const { out, code } = await run(repo, ['install-skill', '--agent', 'codex,copilot', 'junie']);
    expect(code).toBeUndefined();
    expect(out).not.toContain('agents:');
    expect(existsSync(skillAt('.agents', 'skills'))).toBe(true);
    expect(existsSync(skillAt('.copilot', 'skills'))).toBe(false);
    expect(existsSync(skillAt('.junie', 'skills'))).toBe(true);
  });

  it('skips folders already installed and installs the rest', async () => {
    for (const d of ['.claude', '.kiro']) mkdirSync(join(home, d));
    mkdirSync(join(home, '.claude', 'skills', 'codechart'), { recursive: true });
    writeFileSync(skillAt('.claude', 'skills'), 'mine');
    const { out, code } = await run(repo, ['install-skill']);
    expect(code).toBeUndefined();
    expect(out).toContain('already installed for Claude Code');
    expect(out).toContain(`installed for Kiro: ${join(home, '.kiro', 'skills', 'codechart')}\n`);
    expect(readFileSync(skillAt('.claude', 'skills'), 'utf8')).toBe('mine');
    expect(readFileSync(skillAt('.kiro', 'skills'), 'utf8')).toBe(skill);
  });

  it('in a terminal, lets you pick among the detected agents', async () => {
    for (const d of ['.claude', '.gemini', '.kiro']) mkdirSync(join(home, d));
    const { shown, code } = await run(repo, ['install-skill'], [1, 2]);
    expect(code).toBeUndefined();
    expect(shown).toEqual(['Claude Code ~/.claude/skills', 'Gemini CLI ~/.gemini/skills', 'Kiro ~/.kiro/skills']);
    expect(existsSync(skillAt('.claude', 'skills'))).toBe(false);
    expect(existsSync(skillAt('.gemini', 'skills'))).toBe(true);
    expect(existsSync(skillAt('.kiro', 'skills'))).toBe(true);
  });

  it('cancelling or picking nothing writes nothing', async () => {
    for (const d of ['.claude', '.kiro']) mkdirSync(join(home, d));
    const cancel = await run(repo, ['install-skill'], 'cancel');
    expect(cancel.code).toBe(1);
    expect(cancel.err).toBe('codechart: cancelled, nothing installed\n');
    process.exitCode = undefined;
    const none = await run(repo, ['install-skill'], []);
    expect(none.code).toBeUndefined();
    expect(none.out).toBe('nothing selected, nothing installed\n');
    expect(existsSync(join(home, '.claude', 'skills'))).toBe(false);
    expect(existsSync(join(home, '.kiro', 'skills'))).toBe(false);
  });

  it('--dir installs into the given skills folder only', async () => {
    mkdirSync(join(home, '.claude'));
    const { code } = await run(repo, ['install-skill', '--dir', 'my-skills']);
    expect(code).toBeUndefined();
    expect(readFileSync(join(repo, 'my-skills', 'codechart', 'SKILL.md'), 'utf8')).toBe(skill);
    expect(existsSync(skillAt('.claude', 'skills'))).toBe(false);
  });

  it('unknown agent and no agent found fail without writing', async () => {
    const unknown = await run(repo, ['install-skill', '--agent', 'nope']);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toMatch(/^codechart: unknown agent 'nope' \(known: claude, codex, /);
    process.exitCode = undefined;
    const none = await run(repo, ['install-skill']);
    expect(none.code).toBe(1);
    expect(none.err).toContain('no agent found');
    expect(readdirSync(home)).toEqual([]);
  });
});

describe('codechart init', () => {
  it('init writes template at git root', async () => {
    const nested = join(repo, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    const { out, code } = await run(nested, ['init']);
    expect(code).toBeUndefined();
    expect(readFileSync(join(repo, '.codechart.yaml'), 'utf8')).toBe(template);
    expect(out).toContain(join(repo, '.codechart.yaml'));
  });

  it('init refuses overwrite', async () => {
    writeFileSync(join(repo, '.codechart.yaml'), 'mine');
    const { err, code } = await run(repo, ['init']);
    expect(code).toBe(1);
    expect(err).toBe(`exists: ${join(repo, '.codechart.yaml')} (use --force)\n`);
    expect(readFileSync(join(repo, '.codechart.yaml'), 'utf8')).toBe('mine');
    process.exitCode = undefined;
    expect((await run(repo, ['init', '--force'])).code).toBeUndefined();
    expect(readFileSync(join(repo, '.codechart.yaml'), 'utf8')).toBe(template);
  });

  it('init filesystem error -> codechart: message, exit 1', async () => {
    mkdirSync(join(repo, '.codechart.yaml'));
    const { err, code } = await run(repo, ['init', '--force']);
    expect(code).toBe(1);
    expect(err).toMatch(/^codechart: \S.*\n$/);
  });

  it('init outside a git repo fails', async () => {
    const outside = join(tmp, 'plain');
    mkdirSync(outside);
    const { err, code } = await run(outside, ['init']);
    expect(code).toBe(1);
    expect(err).toBe('codechart: not a git repository\n');
    expect(existsSync(join(outside, '.codechart.yaml'))).toBe(false);
  });
});

describe('templates/codechart.yaml', () => {
  it('template parses with loadConfig and changes nothing', () => {
    const builtin = loadConfig({ cwd: repo, home, env: {} });
    writeFileSync(join(repo, '.codechart.yaml'), template);
    const c = loadConfig({ cwd: repo, home, env: {} });
    expect(c).toEqual(builtin);
  });

  it('template first line is the $schema comment', () => {
    expect(template.split('\n')[0]).toBe(
      '# yaml-language-server: $schema=https://unpkg.com/codechart/config.schema.json',
    );
  });

  it('spec-guide mentions every status', () => {
    for (const status of STATUSES) expect(specGuide, status).toContain(`\`${status}\``);
  });

  it('flow-guide mentions every flow status', () => {
    for (const status of STEP_STATUSES) expect(flowGuide, status).toContain(`\`${status}\``);
  });

  it('template mentions every key of the config schema', () => {
    const keys = new Set<string>();
    const walk = (s: Record<string, unknown>) => {
      const props = s.properties as Record<string, Record<string, unknown>> | undefined;
      for (const [k, v] of Object.entries(props ?? {})) {
        keys.add(k);
        walk(v);
      }
      if (s.items) walk(s.items as Record<string, unknown>);
    };
    walk(configJsonSchema() as Record<string, unknown>);
    expect([...keys]).toEqual(expect.arrayContaining(['terminalMaxNodes', 'maxAgeDays', 'useBuiltinRules', 'when']));
    for (const key of keys) expect(template, key).toMatch(new RegExp(`\\b${key}:`));
  });
});
