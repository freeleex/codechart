import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram, runProgram } from '../../src/program.js';

const root = join(import.meta.dirname, '..', '..');
const template = readFileSync(join(root, 'templates', 'codechart.yaml'), 'utf8');
const skill = readFileSync(join(root, 'skills', 'codechart', 'SKILL.md'), 'utf8');

let tmp: string;
let home: string;
let repo: string;
let victim: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-symtarget-'));
  home = join(tmp, 'home');
  repo = join(tmp, 'repo');
  victim = join(tmp, 'victim.txt');
  mkdirSync(home);
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
  await runProgram(program, args, 'user');
  return { out, err, code: process.exitCode };
}

describe('init / install-skill never write through a symlink (S-9)', () => {
  it('init: dangling .codechart.yaml symlink -> refused, nothing created outside the repo', async () => {
    const target = join(repo, '.codechart.yaml');
    symlinkSync(victim, target);
    const { err, code } = await run(['init']);
    expect(code).toBe(1);
    expect(err).toBe(`codechart: ${target}: is a symlink (use --force to replace it)\n`);
    expect(existsSync(victim)).toBe(false);
  });

  it('init --force: symlink to an outside file -> link replaced by a regular file, outside file untouched', async () => {
    const target = join(repo, '.codechart.yaml');
    writeFileSync(victim, 'precious');
    symlinkSync(victim, target);
    const { code } = await run(['init', '--force']);
    expect(code).toBeUndefined();
    expect(readFileSync(victim, 'utf8')).toBe('precious');
    expect(readFileSync(target, 'utf8')).toBe(template);
    expect(lstatSync(target).isSymbolicLink()).toBe(false);
  });

  it('install-skill: dangling SKILL.md symlink -> skipped, nothing written', async () => {
    const dir = join(home, '.claude', 'skills', 'codechart');
    mkdirSync(dir, { recursive: true });
    symlinkSync(victim, join(dir, 'SKILL.md'));
    const { out, code } = await run(['install-skill']);
    expect(code).toBeUndefined();
    expect(out).toContain(`already installed for Claude Code: ${dir} (--force to update)\n`);
    expect(existsSync(victim)).toBe(false);
    expect(existsSync(join(dir, 'example.md'))).toBe(false);
  });

  it('install-skill --force: SKILL.md symlink -> replaced, outside file untouched', async () => {
    const dir = join(home, '.claude', 'skills', 'codechart');
    mkdirSync(dir, { recursive: true });
    writeFileSync(victim, 'precious');
    symlinkSync(victim, join(dir, 'SKILL.md'));
    const { code } = await run(['install-skill', '--force']);
    expect(code).toBeUndefined();
    expect(readFileSync(victim, 'utf8')).toBe('precious');
    expect(lstatSync(join(dir, 'SKILL.md')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe(skill);
  });
});
