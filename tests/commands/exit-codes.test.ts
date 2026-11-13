import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git, makeSandbox, removeSandbox, runCli, type Sandbox } from '../helpers/sandbox.js';

let sb: Sandbox;

beforeEach(() => {
  sb = makeSandbox('exit-codes', { git: 'init', htmlOut: true });
});
afterEach(() => removeSandbox(sb.tmp));

const spec = () => {
  const file = join(sb.tmp, 's.json');
  writeFileSync(file, JSON.stringify({ title: 'T', kind: 'summary', nodes: [{ id: 'a', label: 'A', kind: 'model', status: 'context', layer: 'backend' }], edges: [] }));
  return file;
};
const run = (args: string[]) => runCli({ cwd: sb.repo, home: sb.home, isTTY: false }, args);

describe('exit 2 for usage and revision errors, 1 for other failures', () => {
  it('render --commit <unknown> exits 2', async () => {
    const r = await run(['render', spec(), '--commit', 'nope', '--output', 'cli']);
    expect(r.err).toContain('--commit nope is not a commit');
    expect(r.code).toBe(2);
  });

  it('render --commit -x exits 2', async () => {
    const r = await run(['render', spec(), '--commit', '-x', '--output', 'cli']);
    expect(r.err).toContain('--commit');
    expect(r.code).toBe(2);
  });

  it('render --at <unknown> exits 2', async () => {
    const r = await run(['render', spec(), '--at', 'nope', '--output', 'cli']);
    expect(r.err).toContain('--at nope is not a commit');
    expect(r.code).toBe(2);
  });

  it('render --since <unknown> exits 2', async () => {
    const r = await run(['render', spec(), '--since', 'nope', '--output', 'cli']);
    expect(r.err).toContain('--since nope is not a commit');
    expect(r.code).toBe(2);
  });

  it('render --since HEAD --head <unknown> exits 2', async () => {
    git(sb.repo, 'commit', '-q', '--allow-empty', '-m', 'base');
    const r = await run(['render', spec(), '--since', 'HEAD', '--head', 'nope', '--output', 'cli']);
    expect(r.err).toContain('--head nope is not a commit');
    expect(r.code).toBe(2);
  });

  it('a render failure that is not a usage error still exits 1', async () => {
    const r = await run(['render', join(sb.tmp, 'missing.json'), '--output', 'cli']);
    expect(r.err).not.toBe('');
    expect(r.code).toBe(1);
  });

  it('install-skill --agent <unknown> exits 2', async () => {
    const r = await run(['install-skill', '--agent', 'nope']);
    expect(r.err).toContain("unknown agent 'nope'");
    expect(r.code).toBe(2);
  });

  it('a helper that cannot be added reports what failed and exits 1, the skill stays installed', async () => {
    mkdirSync(join(sb.home, '.claude', 'CLAUDE.md'), { recursive: true });
    const r = await run(['install-skill', '--agent', 'claude', '--reminder']);
    expect(r.err).toMatch(/^codechart: reminder: .*not a regular file/);
    expect(r.code).toBe(1);
    expect(readFileSync(join(sb.home, '.claude', 'skills', 'codechart', 'SKILL.md'), 'utf8')).toContain('codechart');
  });
});
