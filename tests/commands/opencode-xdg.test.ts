import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox, removeSandbox, runCli, type Sandbox } from '../helpers/sandbox.js';

let sb: Sandbox;
let xdg: string;

beforeEach(() => {
  sb = makeSandbox('ocxdg', { git: 'init' });
  xdg = join(sb.tmp, 'x');
  mkdirSync(xdg);
});

afterEach(() => removeSandbox(sb.tmp));

const root = () => join(xdg, 'opencode');
const stray = () => join(sb.home, '.config', 'opencode');
const plugin = () => join(root(), 'plugins', 'codechart.js');
const run = (args: string[], env: Record<string, string> = { XDG_CONFIG_HOME: xdg }) =>
  runCli({ cwd: sb.repo, home: sb.home, env: { PATH: '', ...env }, tool: () => 'opencode 2.0.0' }, args);

describe('OpenCode files with XDG_CONFIG_HOME set', () => {
  it('install-skill --agent opencode puts the skill, reminder and plugin under $XDG_CONFIG_HOME/opencode', async () => {
    await run(['install-skill', '--agent', 'opencode']);
    expect(existsSync(join(root(), 'skills', 'codechart', 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(root(), 'AGENTS.md'), 'utf8')).toContain('codechart');
    expect(existsSync(plugin())).toBe(true);
    expect(existsSync(stray())).toBe(false);
  });

  it('install-skill without --agent detects OpenCode from that folder alone', async () => {
    mkdirSync(root());
    const r = await run(['install-skill', '--no-reminder', '--no-plugin']);
    expect(r.out).toContain('agents: OpenCode');
    expect(existsSync(join(root(), 'skills', 'codechart', 'SKILL.md'))).toBe(true);
    expect(existsSync(stray())).toBe(false);
  });

  it('doctor reports them and uninstall removes them', async () => {
    await run(['install-skill', '--agent', 'opencode']);
    const d = (await run(['doctor'])).out;
    expect(d).toContain(`✓ skill: ${join(root(), 'skills', 'codechart')} (current)`);
    expect(d).toContain(`✓ reminder: ${join(root(), 'AGENTS.md')}`);
    expect(d).toContain(`✓ plugin: ${plugin()} (current)`);
    const u = (await run(['uninstall'])).out;
    expect(u).toContain(`removed skill: ${join(root(), 'skills', 'codechart')}`);
    expect(u).toContain(`removed reminder: ${join(root(), 'AGENTS.md')}`);
    expect(u).toContain(`removed plugin: ${plugin()}`);
    expect(existsSync(plugin())).toBe(false);
    expect(existsSync(join(root(), 'skills', 'codechart'))).toBe(false);
  });

  it('update refreshes an outdated reminder there', async () => {
    await run(['install-skill', '--agent', 'opencode']);
    writeFileSync(join(root(), 'AGENTS.md'), '<!-- codechart -->\nold line\n<!-- /codechart -->\n');
    const r = await run(['update', '--skills-only']);
    expect(r.out).toContain(`reminder updated: ${join(root(), 'AGENTS.md')}`);
    expect(readFileSync(join(root(), 'AGENTS.md'), 'utf8')).not.toContain('old line');
  });

  it('without the variable the paths are the same as before', async () => {
    mkdirSync(stray(), { recursive: true });
    await run(['install-skill', '--agent', 'opencode'], {});
    expect(existsSync(join(stray(), 'skills', 'codechart', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(stray(), 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(stray(), 'plugins', 'codechart.js'))).toBe(true);
    expect(existsSync(root())).toBe(false);
  });
});
