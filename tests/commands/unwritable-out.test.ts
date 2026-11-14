import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox, removeSandbox, runCli, type Sandbox } from '../helpers/sandbox.js';

let sb: Sandbox;

beforeEach(() => {
  sb = makeSandbox('unwritable-out', { git: 'init', htmlOut: true });
  mkdirSync(sb.out);
});
afterEach(() => {
  chmodSync(sb.out, 0o700);
  removeSandbox(sb.tmp);
});

const spec = () => {
  const file = join(sb.tmp, 's.json');
  writeFileSync(file, JSON.stringify({ title: 'T', kind: 'plan', nodes: [{ id: 'a', label: 'A', kind: 'model', status: 'new', layer: 'backend' }], edges: [] }));
  return file;
};
const message = () => `can't write to ${sb.out}`;
const fix = () => `(permission denied): fix its permissions or set web.outDir in ${join(sb.home, '.config', 'codechart', 'config.yaml')}`;

describe.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('an output folder that cannot be written', () => {
  it('--output web names the folder and the setting to change, exits 1, no stack', async () => {
    chmodSync(sb.out, 0o000);
    const r = await runCli({ cwd: sb.repo, home: sb.home, isTTY: false }, ['render', spec(), '--output', 'web']);
    expect(r.err.startsWith(`codechart: ${message()}`)).toBe(true);
    expect(r.err.endsWith(` ${fix()}\n`)).toBe(true);
    expect(r.err.split('\n')).toHaveLength(2);
    expect(r.err).not.toContain('EACCES');
    expect(r.err).not.toContain('lstat');
    expect(r.code).toBe(1);
  });

  it('--output cli says the same instead of the raw error', async () => {
    chmodSync(sb.out, 0o000);
    const r = await runCli({ cwd: sb.repo, home: sb.home, isTTY: false }, ['render', spec(), '--output', 'cli']);
    expect(r.err).toContain(message());
    expect(r.err).toContain(fix());
    expect(r.err).not.toContain('EACCES');
  });
});
