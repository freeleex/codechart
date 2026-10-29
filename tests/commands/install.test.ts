import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

async function run(cwd: string, args: string[]) {
  let out = '';
  let err = '';
  const program = buildProgram({ cwd, home, env: {}, stdout: (s) => (out += s), stderr: (s) => (err += s) });
  await runProgram(program, args, 'user');
  return { out, err, code: process.exitCode };
}

describe('codechart install-skill', () => {
  const target = () => join(home, '.claude', 'skills', 'codechart', 'SKILL.md');

  it('install-skill writes file in temp HOME', async () => {
    const { out, code } = await run(repo, ['install-skill']);
    expect(code).toBeUndefined();
    expect(readFileSync(target(), 'utf8')).toBe(skill);
    expect(out).toContain(target());
  });

  it('installs every file of the skill, so its links resolve', async () => {
    await run(repo, ['install-skill']);
    for (const f of ['spec-guide.md', 'flow-guide.md', 'example.md']) {
      expect(readFileSync(join(home, '.claude', 'skills', 'codechart', f), 'utf8')).toBe(
        readFileSync(join(root, 'skills', 'codechart', f), 'utf8'),
      );
    }
  });

  it('refuses overwrite', async () => {
    mkdirSync(join(home, '.claude', 'skills', 'codechart'), { recursive: true });
    writeFileSync(target(), 'mine');
    const { err, code } = await run(repo, ['install-skill']);
    expect(code).toBe(1);
    expect(err).toBe(`exists: ${target()} (use --force)\n`);
    expect(readFileSync(target(), 'utf8')).toBe('mine');
  });

  it('refuses when any skill file exists, writing nothing', async () => {
    const dir = join(home, '.claude', 'skills', 'codechart');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'spec-guide.md'), 'mine');
    const { err, code } = await run(repo, ['install-skill']);
    expect(code).toBe(1);
    expect(err).toBe(`exists: ${join(dir, 'spec-guide.md')} (use --force)\n`);
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
