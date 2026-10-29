import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/load.js';

let tmp: string;
let home: string;
let repo: string;
let repoFile: string;
let globalFile: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-trust-'));
  home = join(tmp, 'home');
  repo = join(tmp, 'repo');
  repoFile = join(repo, '.codechart.yaml');
  globalFile = join(home, '.config', 'codechart', 'config.yaml');
  mkdirSync(join(home, '.config', 'codechart'), { recursive: true });
  mkdirSync(join(repo, '.git'), { recursive: true });
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const load = () => loadConfig({ cwd: repo, home, env: {} });
const message = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('did not throw');
};

describe('config file must be a small regular file (S-2)', () => {
  // /dev/zero and symlinks do not exist on Windows runners
  it.skipIf(process.platform === 'win32')('repo .codechart.yaml -> /dev/zero: refused instead of reading forever', () => {
    symlinkSync('/dev/zero', repoFile);
    expect(message(load)).toBe(`${repoFile}: resolves outside the repo`);
  });

  it.skipIf(process.platform === 'win32')('global config -> /dev/zero: refused instead of reading forever', () => {
    symlinkSync('/dev/zero', globalFile);
    expect(message(load)).toBe(`${globalFile}: not a regular file`);
  });

  it('repo .codechart.yaml is a directory -> one-line error', () => {
    mkdirSync(repoFile);
    expect(message(load)).toBe(`${repoFile}: not a regular file`);
  });

  it('over 1 MB -> refused', () => {
    writeFileSync(repoFile, `# ${'x'.repeat(1024 * 1024)}\n`);
    expect(message(load)).toBe(`${repoFile}: too large (over 1 MB)`);
  });

  it('global config over 1 MB -> refused', () => {
    writeFileSync(globalFile, `# ${'x'.repeat(1024 * 1024)}\n`);
    expect(message(load)).toBe(`${globalFile}: too large (over 1 MB)`);
  });

  it('repo .codechart.yaml symlinked outside the repo -> refused, target not parsed', () => {
    const outside = join(tmp, 'secret.yaml');
    writeFileSync(outside, 'password: hunter2\n');
    symlinkSync(outside, repoFile);
    const msg = message(load);
    expect(msg).toBe(`${repoFile}: resolves outside the repo`);
    expect(msg).not.toContain('password');
  });

  it('repo .codechart.yaml symlinked to a file inside the repo -> loaded', () => {
    writeFileSync(join(repo, 'cfg.yaml'), 'defaults:\n  output: web\n');
    symlinkSync('cfg.yaml', repoFile);
    expect(load().defaults.output).toBe('web');
  });

  it('global config symlinked elsewhere (dotfiles) -> loaded', () => {
    rmSync(join(home, '.config', 'codechart'), { recursive: true });
    mkdirSync(join(tmp, 'dotfiles'));
    writeFileSync(join(tmp, 'dotfiles', 'config.yaml'), 'defaults:\n  output: cli\n');
    symlinkSync(join(tmp, 'dotfiles'), join(home, '.config', 'codechart'));
    expect(load().defaults.output).toBe('cli');
  });
});
