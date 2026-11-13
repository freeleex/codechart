import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findOnPath } from '../../src/commands/doctor-checks.js';
import { writeRecord, type TurnRecord } from '../../src/commands/hook-record.js';
import { currentVersion } from '../../src/update/check.js';
import { makeSandbox, removeSandbox, repoFromTemplate, runCli, type Sandbox } from '../helpers/sandbox.js';

let sb: Sandbox;
let env: NodeJS.ProcessEnv;

const LATEST = currentVersion().replace(/^(\d+)\./, (_, m: string) => `${Number(m) + 1}.`);

beforeEach(() => {
  sb = makeSandbox('doctor', { git: 'init' });
  const bin = join(sb.tmp, 'bin');
  mkdirSync(bin);
  for (const name of ['codechart', 'codechart.cmd']) writeFileSync(join(bin, name), '#!/bin/sh\n');
  chmodSync(join(bin, 'codechart'), 0o755);
  env = { PATH: bin };
});

afterEach(() => removeSandbox(sb.tmp));

// Paths print natively (like install-skill); tests compare with the home folder as ~ and / separators.
const norm = (s: string) => s.split(sb.home).join('~').replaceAll('\\', '/');
const run = async (args: string[], extra: Parameters<typeof runCli>[0] = {}) => {
  const r = await runCli({ cwd: sb.repo, home: sb.home, env, ...extra }, args);
  return { ...r, out: norm(r.out), err: norm(r.err) };
};
const home = (...p: string[]) => join(sb.home, ...p);
const install = (...agents: string[]) => {
  for (const a of agents) mkdirSync(home(a === 'claude' ? '.claude' : `.${a}`), { recursive: true });
  return run(['install-skill', '--agent', agents.join(',')]);
};
const cached = (state: object) => {
  mkdirSync(home('.cache', 'codechart'), { recursive: true });
  writeFileSync(home('.cache', 'codechart', 'update-check.json'), JSON.stringify(state));
};
const lines = (out: string) => out.split('\n').filter((l) => /^ {2}[✓✗⚠]/.test(l));

describe('doctor', () => {
  it('all good: ticks, a warning for an agent without hooks, a test prompt, exit 0', async () => {
    await install('claude', 'codex');
    const r = await run(['doctor']);
    expect(r.code).toBeUndefined();
    expect(r.out).toContain('Claude Code\n  ✓ skill: ~/.claude/skills/codechart (current)\n  ✓ reminder: ~/.claude/CLAUDE.md\n  ✓ hook: Stop and prompt hooks in ~/.claude/settings.json\n');
    expect(r.out).toContain('Codex\n  ✓ skill: ~/.agents/skills/codechart (current)\n  ✓ reminder: ~/.codex/AGENTS.md\n  ⚠ hook: no codechart hook for Codex yet\n');
    expect(r.out).toContain(`  ✓ on PATH: ${norm(join(sb.tmp, 'bin'))}/codechart`);
    expect(r.out).toContain(`\n  ✓ version ${currentVersion()} (npm not checked yet)\n`);
    expect(r.out).toContain('To test, paste into your agent:');
    expect(lines(r.out).some((l) => l.includes('✗'))).toBe(false);
  });

  it('a missing skill is a ✗; a missing reminder or hook is a ⚠ (may be opted out), all with the fix command', async () => {
    mkdirSync(home('.claude'));
    mkdirSync(home('.codex'));
    const r = await run(['doctor']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('✗ skill: missing (~/.claude/skills/codechart): run codechart install-skill --agent claude\n');
    expect(r.out).toContain('✗ skill: missing (~/.agents/skills/codechart): run codechart install-skill --agent codex\n');
    expect(r.out).toContain('⚠ reminder: missing in ~/.claude/CLAUDE.md: run codechart install-skill --agent claude --reminder\n');
    expect(r.out).toContain('⚠ hook: missing in ~/.claude/settings.json: run codechart install-skill --agent claude --hook\n');
  });

  it('only opted-out extras missing: warnings, exit 0', async () => {
    mkdirSync(home('.claude'));
    await run(['install-skill', '--agent', 'claude', '--no-reminder', '--no-hook']);
    const r = await run(['doctor']);
    expect(r.code).toBeUndefined();
    expect(r.out).toContain('⚠ reminder: missing');
    expect(r.out).toContain('⚠ hook: missing');
    expect(r.out).not.toContain('✗');
  });

  it('a hook with only one of the two events is a ✗', async () => {
    await install('claude');
    const file = home('.claude', 'settings.json');
    const s = JSON.parse(readFileSync(file, 'utf8'));
    delete s.hooks.Stop;
    writeFileSync(file, JSON.stringify(s));
    const r = await run(['doctor']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('✗ hook: Stop missing in ~/.claude/settings.json: run codechart install-skill --agent claude --hook\n');
  });

  it('hooks whose commands are swapped or misspelled are a ✗, and --fix replaces them', async () => {
    await install('claude');
    const file = home('.claude', 'settings.json');
    const s = JSON.parse(readFileSync(file, 'utf8'));
    s.hooks.UserPromptSubmit[0].hooks[0].command = 'codechart hook stop';
    s.hooks.Stop[0].hooks[0].command = 'codechart hook stp';
    s.hooks.Stop.push({ hooks: [{ type: 'command', command: 'mine' }] });
    writeFileSync(file, JSON.stringify(s));
    const r = await run(['doctor']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('✗ hook: Stop runs the wrong command, UserPromptSubmit runs the wrong command in ~/.claude/settings.json: run codechart install-skill --agent claude --hook\n');
    process.exitCode = undefined;
    const fixed = await run(['doctor', '--fix']);
    expect(fixed.code).toBeUndefined();
    const after = JSON.parse(readFileSync(file, 'utf8'));
    expect(JSON.stringify(after.hooks.UserPromptSubmit)).toBe(JSON.stringify([{ hooks: [{ type: 'command', command: 'codechart hook prompt', timeout: 10 }] }]));
    expect(after.hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: 'mine' }] }, { hooks: [{ type: 'command', command: 'codechart hook stop', timeout: 30 }] }]);
  });

  it('agents sharing a skill folder: the ✗ and fix once, "same copy as" for the rest', async () => {
    mkdirSync(home('.codex'));
    mkdirSync(home('.gemini'));
    const missing = await run(['doctor']);
    expect(missing.out).toContain('Codex\n  ✗ skill: missing (~/.agents/skills/codechart): run codechart install-skill --agent codex\n');
    expect(missing.out).toContain('Gemini CLI\n  ✗ skill: same copy as Codex\n');
    expect(missing.out.match(/install-skill --agent gemini\n/g)).toBeNull();
    await install('codex');
    writeFileSync(home('.agents', 'skills', 'codechart', 'SKILL.md'), '---\nname: codechart\n---\nold\n');
    const stale = await run(['doctor']);
    expect(stale.out).toContain('Codex\n  ✗ skill: outdated at ~/.agents/skills/codechart: run codechart install-skill --agent codex\n');
    expect(stale.out).toContain('Gemini CLI\n  ✗ skill: same copy as Codex\n');
    expect(stale.code).toBe(1);
    const fixed = await run(['doctor', '--fix']);
    expect(fixed.out.match(/updated for/g)).toHaveLength(1);
  });

  it('an older codechart copy and an older reminder are outdated', async () => {
    await install('claude');
    writeFileSync(home('.claude', 'skills', 'codechart', 'SKILL.md'), '---\nname: codechart\n---\nold\n');
    writeFileSync(home('.claude', 'CLAUDE.md'), '<!-- codechart -->\nold\n<!-- /codechart -->\n');
    const r = await run(['doctor']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('✗ skill: outdated at ~/.claude/skills/codechart: run codechart install-skill --agent claude\n');
    expect(r.out).toContain('✗ reminder: outdated in ~/.claude/CLAUDE.md: run codechart install-skill --agent claude --reminder\n');
  });

  it('a folder that is not the codechart skill is reported, with the install command', async () => {
    await install('claude');
    writeFileSync(home('.claude', 'skills', 'codechart', 'SKILL.md'), '---\nname: other\n---\n');
    const r = await run(['doctor']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('✗ skill: ~/.claude/skills/codechart is not the codechart skill (left alone: move it aside first): run codechart install-skill --agent claude\n');
  });

  it('a skill an agent reads from another folder counts', async () => {
    await install('claude');
    mkdirSync(home('.cursor'));
    const r = await run(['doctor']);
    expect(r.out).toContain('Cursor\n  ✓ skill: ~/.claude/skills/codechart (current)\n');
  });

  it('an old copy in an agent\'s own folder is a ✗ even beside a current shared one, and --fix updates it', async () => {
    await install('codex');
    mkdirSync(home('.gemini', 'skills', 'codechart'), { recursive: true });
    const old = home('.gemini', 'skills', 'codechart', 'SKILL.md');
    writeFileSync(old, '---\nname: codechart\n---\nold\n');
    const r = await run(['doctor']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('Gemini CLI\n  ✗ skill: outdated at ~/.gemini/skills/codechart: run codechart install-skill --agent gemini\n');
    const fixed = await run(['doctor', '--fix']);
    expect(fixed.out).toContain('updated for Gemini CLI');
    expect(readFileSync(old, 'utf8')).not.toBe('---\nname: codechart\n---\nold\n');
    expect((await run(['doctor'])).out).toContain('Gemini CLI\n  ✓ skill: ~/.gemini/skills/codechart, ~/.agents/skills/codechart (current)');
  });

  it('settings.json that is not valid JSON is a ✗ with the reason', async () => {
    await install('claude');
    writeFileSync(home('.claude', 'settings.json'), '{ // c\n}');
    const r = await run(['doctor']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('✗ hook: ');
    expect(r.out).toContain('not valid JSON');
  });

  it('no agent found is a ✗', async () => {
    const r = await run(['doctor']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('✗ no agent found in ~: run codechart install-skill --agent <name>\n');
  });

  it('codechart off PATH is a ✗ with npm i -g; an npm version newer than ours too', async () => {
    await install('claude');
    cached({ latest: LATEST, checkedAt: Date.now() });
    const r = await run(['doctor'], { env: { PATH: join(sb.tmp, 'nowhere') } });
    expect(r.code).toBe(1);
    expect(r.out).toContain("✗ not on PATH, so agents can't run it: run npm i -g codechart\n");
    expect(r.out).toContain(`✗ version ${currentVersion()}, npm has ${LATEST}: run codechart update\n`);
    expect((await run(['doctor'])).out).toContain('✗ version');
  });

  it('never goes online', async () => {
    await install('claude');
    const r = await run(['doctor'], {
      fetch: (async () => {
        throw new Error('network');
      }) as typeof fetch,
    });
    expect(r.err).toBe('');
  });
});

describe('doctor --fix', () => {
  it('repairs a missing skill only; a missing reminder or hook is named, not added', async () => {
    mkdirSync(home('.claude'));
    mkdirSync(home('.codex'));
    const r = await run(['doctor', '--fix']);
    expect(r.out).toContain(`installed for Claude Code: ${norm(home('.claude', 'skills', 'codechart'))}`);
    expect(r.out).toContain('not added (opt-in): codechart install-skill --agent claude --reminder\n');
    expect(r.out).toContain('not added (opt-in): codechart install-skill --agent claude --hook\n');
    expect(r.out).toContain('not added (opt-in): codechart install-skill --agent codex --reminder\n');
    expect(r.out).not.toContain('✗');
    expect(r.code).toBeUndefined();
    expect(existsSync(home('.agents', 'skills', 'codechart', 'SKILL.md'))).toBe(true);
    expect(existsSync(home('.claude', 'CLAUDE.md'))).toBe(false);
    expect(existsSync(home('.claude', 'settings.json'))).toBe(false);
  });

  it('completes a half-installed hook', async () => {
    await install('claude');
    const file = home('.claude', 'settings.json');
    const s = JSON.parse(readFileSync(file, 'utf8'));
    delete s.hooks.Stop;
    writeFileSync(file, JSON.stringify(s));
    const r = await run(['doctor', '--fix']);
    expect(r.out).toContain(`hook added: ${norm(file)}`);
    expect(r.code).toBeUndefined();
  });

  it('updates an older copy and reminder', async () => {
    await install('claude');
    writeFileSync(home('.claude', 'skills', 'codechart', 'SKILL.md'), '---\nname: codechart\n---\nold\n');
    writeFileSync(home('.claude', 'CLAUDE.md'), '<!-- codechart -->\nold\n<!-- /codechart -->\n');
    const r = await run(['doctor', '--fix']);
    expect(r.out).toContain('updated for Claude Code');
    expect(r.out).toContain('reminder updated');
    expect(r.code).toBeUndefined();
  });

  it('never overwrites a folder that is not codechart: reports it and exits 1', async () => {
    await install('claude');
    const skill = home('.claude', 'skills', 'codechart', 'SKILL.md');
    writeFileSync(skill, '---\nname: other\n---\nmine\n');
    const r = await run(['doctor', '--fix']);
    expect(readFileSync(skill, 'utf8')).toBe('---\nname: other\n---\nmine\n');
    expect(r.out).toContain('is not the codechart skill');
    expect(r.code).toBe(1);
  });

  it('runs the update for an outdated CLI; one that cannot update stays a ✗', async () => {
    await install('claude');
    cached({ latest: LATEST, checkedAt: Date.now() });
    const calls: string[] = [];
    const r = await run(['doctor', '--fix'], {
      fetch: (async () => new Response(JSON.stringify({ version: LATEST }))) as typeof fetch,
      tool: (c, a) => {
        calls.push(`${c} ${a.join(' ')}`);
        return join(sb.tmp, 'npm-root');
      },
    });
    expect(calls).toEqual(['npm root -g']);
    expect(r.out).toContain(`codechart ${LATEST} is available (you have ${currentVersion()}), but`);
    expect(r.out).toContain('✗ version');
    expect(r.code).toBe(1);
  });

  it('an update that fails is reported on stderr and keeps the exit code', async () => {
    await install('claude');
    cached({ latest: LATEST, checkedAt: Date.now() });
    const r = await run(['doctor', '--fix'], { fetch: (async () => new Response('', { status: 500 })) as typeof fetch });
    expect(r.err).toContain("couldn't reach the npm registry");
    expect(r.code).toBe(1);
  });

  it('with nothing to fix it only reports', async () => {
    await install('claude');
    const r = await run(['doctor', '--fix']);
    expect(r.out).not.toMatch(/installed|updated|added/);
    expect(r.code).toBeUndefined();
  });
});

describe('findOnPath', () => {
  it('looks through PATH entries in order; on Windows with PATHEXT and quoted entries', () => {
    const has = (...files: string[]) => (p: string) => files.includes(p);
    expect(findOnPath({ PATH: '/a:/b' }, 'linux', has('/b/codechart'))).toBe('/b/codechart');
    expect(findOnPath({ PATH: '/a:/b' }, 'linux', has())).toBeUndefined();
    expect(findOnPath({ Path: 'C:\\x;"C:\\npm"' }, 'win32', has('C:\\npm\\codechart.cmd'))).toBe('C:\\npm\\codechart.cmd');
    expect(findOnPath({ PATH: 'C:\\x', PATHEXT: '.EXE' }, 'win32', has('C:\\x\\codechart.cmd'))).toBeUndefined();
    expect(findOnPath({}, 'linux', () => true)).toBeUndefined();
  });
});

describe.skipIf(process.platform === 'win32')('findOnPath on disk', () => {
  const bin = (n: string) => join(sb.tmp, n);

  it('skips a directory or a file without the execute bit, and follows a symlink to a runnable file', () => {
    mkdirSync(join(bin('a'), 'codechart'), { recursive: true });
    mkdirSync(bin('b'));
    writeFileSync(join(bin('b'), 'codechart'), 'x');
    chmodSync(join(bin('b'), 'codechart'), 0o644);
    mkdirSync(bin('c'));
    writeFileSync(join(bin('c'), 'real'), '#!/bin/sh\n');
    chmodSync(join(bin('c'), 'real'), 0o755);
    symlinkSync(join(bin('c'), 'real'), join(bin('c'), 'codechart'));
    const path = [bin('a'), bin('b'), bin('c')].join(':');
    expect(findOnPath({ PATH: path })).toBe(join(bin('c'), 'codechart'));
    expect(findOnPath({ PATH: [bin('a'), bin('b')].join(':') })).toBeUndefined();
  });

  it('a doctor run reports a non-runnable codechart as not on PATH', async () => {
    mkdirSync(home('.claude'));
    const dead = bin('dead');
    mkdirSync(join(dead, 'codechart'), { recursive: true });
    expect((await run(['doctor'], { env: { PATH: dead } })).out).toContain("✗ not on PATH, so agents can't run it");
  });
});

describe('doctor --last', () => {
  const dir = () => home('.cache', 'codechart', 'turns');
  const record = (r: Partial<TurnRecord>) => writeRecord(dir(), { at: '2026-11-05T10:00:00.000Z', root: sb.repo, session: 's1', ...r });

  beforeEach(async () => {
    repoFromTemplate(sb.repo);
    await install('claude');
  });

  it('without Claude hooks or the OpenCode plugin it says nothing was logged', async () => {
    writeFileSync(home('.claude', 'settings.json'), '{}');
    const r = await run(['doctor', '--last']);
    expect(r.out).toContain('hooks and the OpenCode plugin are not installed');
    expect(r.out).toContain('supports Claude Code and OpenCode');
    expect(r.out).toContain('codechart install-skill --agent claude --hook');
    expect(r.out).toContain('codechart install-skill --agent opencode --plugin');
    expect(r.code).toBeUndefined();
  });

  it('no record at all: the hooks never ran, with the SDK issue and the doctor pointer', async () => {
    const r = await run(['doctor', '--last']);
    expect(r.out).toContain('the hooks never ran here');
    expect(r.out).toContain('anthropics/claude-code#87657');
    expect(r.out).toContain('codechart doctor');
  });

  it('records of other repos do not count', async () => {
    record({ root: join(sb.tmp, 'elsewhere'), decision: 'nudged' });
    expect((await run(['doctor', '--last'])).out).toContain('the hooks never ran here');
  });

  it('a prompt without a Stop decision: the Stop hook did not run', async () => {
    record({});
    expect((await run(['doctor', '--last'])).out).toContain('the Stop hook left no decision');
  });

  it('takes the newest record of this repo', async () => {
    record({ session: 'old', at: '2026-11-04T10:00:00.000Z', decision: 'nudged', files: ['a.ts'] });
    record({ session: 'new', decision: 'diagram-in-reply', files: ['a.ts'] });
    const r = await run(['doctor', '--last']);
    expect(r.out).toContain('session new');
    expect(r.out).toContain('Decision: diagram-in-reply: the reply already had a codechart diagram.');
  });

  it('a newer prompt without a Stop, or a later turn that changed nothing, is noted; the decided turn is still explained', async () => {
    record({ decision: 'nudged', files: ['a.ts', 'b.ts', 'c.ts'], pendingAt: '2026-11-05T11:00:00.000Z' });
    const pending = await run(['doctor', '--last']);
    expect(pending.out).toContain('A newer prompt (2026-11-05T11:00:00.000Z) has no Stop decision yet');
    expect(pending.out).toContain('Decision: nudged');
    record({ decision: 'nudged', files: ['a.ts', 'b.ts', 'c.ts'], quietAt: '2026-11-05T12:00:00.000Z' });
    const quiet = await run(['doctor', '--last']);
    expect(quiet.out).toContain('A later turn (2026-11-05T12:00:00.000Z) changed no files');
    expect(quiet.out).toContain('Changed files: 3');
  });

  it('explains each decision in words', async () => {
    const said = async (decision: TurnRecord['decision']) => {
      record({ decision, files: ['a.ts', 'b.ts', 'c.ts'] });
      return (await run(['doctor', '--last'])).out;
    };
    expect(await said('stop_hook_active')).toContain('already asked once');
    expect(await said('no-snapshot')).toContain('no snapshot');
    expect(await said('other-root')).toContain('different repo');
    expect(await said('few-files')).toContain('fewer than 3 files');
    expect(await said('codechart-used')).toContain('already ran codechart');
    expect(await said('nudged')).toContain('sent the agent back');
  });

  it('few files but a rule fires: the hook and the rules disagree', async () => {
    record({ decision: 'few-files', files: ['db/migrations/0001_add.sql'] });
    const r = await run(['doctor', '--last']);
    expect(r.out).toContain('rule migrations fires (map) on db/migrations/0001_add.sql');
    expect(r.out).toContain('the hook and the rules disagree: a rule fires on 1 file, but the hook only asks from 3');
  });

  it('nudged but no rule fires: says so, and that they disagree', async () => {
    record({ decision: 'nudged', files: ['a.test.ts', 'b.test.ts', 'package-lock.json'] });
    const r = await run(['doctor', '--last']);
    expect(r.out).toContain('no rule fires (e.g. only tests or generated files changed)');
    expect(r.out).toContain('a nudge here is expected');
    expect(r.out).toContain('judges related-files and behaviour-flow itself');
    expect(r.out).not.toContain('disagree');
  });

  it('says whether the skill was loaded', async () => {
    record({ decision: 'nudged', files: ['x/models.py', 'x/a.ts', 'x/b.ts'], skill: false });
    expect((await run(['doctor', '--last'])).out).toContain('did not load the codechart skill');
    record({ decision: 'nudged', files: ['x/models.py', 'x/a.ts', 'x/b.ts'], skill: true });
    const r = await run(['doctor', '--last']);
    expect(r.out).toContain('loaded the codechart skill');
    expect(r.out).not.toContain('did not');
    expect(r.out).not.toContain('disagree');
  });

  it('file names from the record cannot put control bytes on the terminal', async () => {
    record({ decision: 'nudged', files: ['a\u001b]0;pwned\u0007.ts', 'b.ts', 'c.ts'] });
    const r = await run(['doctor', '--last']);
    expect(r.out).toContain('Changed files: 3');
    expect(r.out.replace(/\n/g, '')).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  });

  it('outside a git repo it fails with exit 1', async () => {
    const r = await run(['doctor', '--last'], { cwd: sb.tmp });
    expect(r.err).toContain('not in a git repo');
    expect(r.code).toBe(1);
  });
});
