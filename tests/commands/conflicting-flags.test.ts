import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git, makeSandbox, removeSandbox, runCli, type Sandbox } from '../helpers/sandbox.js';

let sb: Sandbox;

beforeEach(async () => {
  sb = makeSandbox('conflicts', { git: 'init', htmlOut: true });
  mkdirSync(join(sb.repo, 'app'));
  writeFileSync(join(sb.repo, 'app/orders.py'), 'class Order:\n    pass\n');
  git(sb.repo, 'add', '.');
  git(sb.repo, 'commit', '-q', '-m', 'init');
  writeFileSync(join(sb.repo, 'app/orders.py'), 'class Order:\n    coupon = 1\n');
  const spec = { title: 'Orders', kind: 'summary', nodes: [{ id: 'Order', label: 'Order', kind: 'model', status: 'changed', layer: 'backend', path: 'app/orders.py' }], edges: [] };
  writeFileSync(join(sb.tmp, 'spec.json'), JSON.stringify(spec));
  await run(['render', join(sb.tmp, 'spec.json'), '--git', '--output', 'web']);
  process.exitCode = undefined;
});
afterEach(() => removeSandbox(sb.tmp));

const run = (args: string[], extra = {}) => {
  process.exitCode = undefined;
  return runCli({ cwd: sb.repo, home: sb.home, isTTY: false, ...extra }, args);
};

describe('conflicting or half-given flags are a usage error (exit 2)', () => {
  it('doctor --fix --last', async () => {
    const r = await run(['doctor', '--fix', '--last']);
    expect(r.err).toMatch(/--last.*--fix|--fix.*--last/);
    expect(r.code).toBe(2);
  });

  it('update --check --skills-only', async () => {
    const r = await run(['update', '--check', '--skills-only']);
    expect(r.err).toMatch(/--skills-only.*--check|--check.*--skills-only/);
    expect(r.code).toBe(2);
  });

  it('comment --side without a line', async () => {
    const r = await run(['comment', '--side', 'old', 'Order', 'hello']);
    expect(r.err).toContain('--side needs a line');
    expect(r.code).toBe(2);
    expect((await run(['feedback'])).out).toBe('No pending review notes.\n');
  });

  it('feedback --import --copy without --take', async () => {
    const r = await run(['feedback', '--import', '--copy'], { stdin: async () => '' });
    expect(r.err).toMatch(/--copy.*--take/);
    expect(r.code).toBe(2);
  });

  it('the valid combinations still work', async () => {
    const side = await run(['comment', '--side', 'new', 'Order:app/orders.py:2', 'hello']);
    expect(side.err).toBe('');
    expect(side.out).toContain('Comment added');
    expect(side.code).toBeUndefined();
    expect((await run(['feedback', '--copy', '--take'])).code).toBeUndefined();
    expect((await run(['doctor', '--last'])).code).not.toBe(2);
    expect((await run(['doctor', '--fix'])).code).not.toBe(2);
    const refresh = await run(['update', '--skills-only']);
    expect(refresh.err).toBe('');
    expect(refresh.code).toBeUndefined();
  });
});
