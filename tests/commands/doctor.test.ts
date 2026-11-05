import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  writeFileSync(join(bin, 'codechart'), '#!/bin/sh\n');
  chmodSync(join(bin, 'codechart'), 0o755);
  env = { PATH: bin };
});

afterEach(() => removeSandbox(sb.tmp));

const run = (args: string[], extra: Parameters<typeof runCli>[0] = {}) => runCli({ cwd: sb.repo, home: sb.home, env, ...extra }, args);
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
    expect(r.out).toContain('Codex\n  ✓ skill: ~/.agents/skills/codechart (current)\n  ✓ reminder: ~/.codex/AGENTS.md\n  ⚠ hook: none, Codex has no hook support');
    expect(r.out).toContain(`  ✓ on PATH: ${join(sb.tmp, 'bin', 'codechart')}\n  ✓ version ${currentVersion()} (npm not checked yet)\n`);
    expect(r.out).toContain('To test, paste into your agent:');
    expect(lines(r.out).some((l) => l.includes('✗'))).toBe(false);
  });

  it('a missing skill, reminder and hook each say the fix command; exit 1', async () => {
    mkdirSync(home('.claude'));
    mkdirSync(home('.codex'));
    const r = await run(['doctor']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('✗ skill: missing (~/.claude/skills/codechart): run codechart install-skill --agent claude\n');
    expect(r.out).toContain('✗ skill: missing (~/.agents/skills/codechart): run codechart install-skill --agent codex\n');
    expect(r.out).toContain('✗ reminder: missing in ~/.claude/CLAUDE.md: run codechart install-skill --agent claude --reminder\n');
    expect(r.out).toContain('✗ hook: Stop and UserPromptSubmit missing in ~/.claude/settings.json: run codechart install-skill --agent claude --hook\n');
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
  it('repairs a missing skill, reminder and hook, says what it did, and exits 0', async () => {
    mkdirSync(home('.claude'));
    mkdirSync(home('.codex'));
    const r = await run(['doctor', '--fix']);
    expect(r.out).toContain(`installed for Claude Code: ${home('.claude', 'skills', 'codechart')}`);
    expect(r.out).toContain(`reminder added: ${home('.claude', 'CLAUDE.md')}`);
    expect(r.out).toContain(`hook added: ${home('.claude', 'settings.json')}`);
    expect(r.out).toContain(`reminder added: ${home('.codex', 'AGENTS.md')}`);
    expect(r.out).not.toContain('✗');
    expect(r.code).toBeUndefined();
    expect(existsSync(home('.agents', 'skills', 'codechart', 'SKILL.md'))).toBe(true);
    expect((await run(['doctor'])).code).toBeUndefined();
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

describe('doctor --last', () => {
  const dir = () => home('.cache', 'codechart', 'turns');
  const record = (r: Partial<TurnRecord>) => writeRecord(dir(), { at: '2026-11-05T10:00:00.000Z', root: sb.repo, session: 's1', ...r });

  beforeEach(async () => {
    repoFromTemplate(sb.repo);
    await install('claude');
  });

  it('without Claude hooks it says nothing was logged and supports Claude Code only', async () => {
    writeFileSync(home('.claude', 'settings.json'), '{}');
    const r = await run(['doctor', '--last']);
    expect(r.out).toContain('hooks are not installed');
    expect(r.out).toContain('Claude Code only for now');
    expect(r.out).toContain('codechart install-skill --agent claude --hook');
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
    expect(r.out).toContain('it asked for a diagram, but no path rule fires');
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

  it('outside a git repo it fails with exit 1', async () => {
    const r = await run(['doctor', '--last'], { cwd: sb.tmp });
    expect(r.err).toContain('not in a git repo');
    expect(r.code).toBe(1);
  });
});
