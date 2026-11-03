import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { changedFiles, turnUsedCodechart } from '../../src/commands/hook.js';
import { addReminder, installClaudeHooks, REMINDER, removeClaudeHooks, removeReminder } from '../../src/commands/nudges.js';
import { buildProgram, runProgram } from '../../src/program.js';
import { git, gitInit, makeSandbox, removeSandbox, runCli } from '../helpers/sandbox.js';

let tmp: string;
let home: string;
let repo: string;

beforeEach(() => {
  ({ tmp, home, repo } = makeSandbox('nudges'));
});

afterEach(() => removeSandbox(tmp));

const BLOCK = `<!-- codechart -->\n${REMINDER}\n<!-- /codechart -->\n`;

const run = (args: string[], stdin = '', choose?: (t: string, items: { label: string; hint: string }[], checked?: boolean) => Promise<number[] | undefined>) =>
  runCli({ cwd: repo, home, stdin: async () => stdin, choose }, args);

describe('addReminder', () => {
  const file = () => join(home, 'CLAUDE.md');

  it('creates the file, or appends after a blank line, once', () => {
    expect(addReminder(file(), false)).toBe('added');
    expect(readFileSync(file(), 'utf8')).toBe(BLOCK);
    writeFileSync(file(), '# mine\n- a rule');
    expect(addReminder(file(), false)).toBe('added');
    expect(readFileSync(file(), 'utf8')).toBe(`# mine\n- a rule\n\n${BLOCK}`);
    expect(addReminder(file(), false)).toBe('present');
    expect(readFileSync(file(), 'utf8')).toBe(`# mine\n- a rule\n\n${BLOCK}`);
  });

  it('a different reminder stays unless forced, and only the block is replaced', () => {
    writeFileSync(file(), 'before\n<!-- codechart -->\nold text\n<!-- /codechart -->\nafter\n');
    expect(addReminder(file(), false)).toBe('outdated');
    expect(readFileSync(file(), 'utf8')).toContain('old text');
    expect(addReminder(file(), true)).toBe('updated');
    expect(readFileSync(file(), 'utf8')).toBe(`before\n${BLOCK}after\n`);
  });

  it('writes through a symlink (dotfiles) but refuses a folder', () => {
    const real = join(tmp, 'dotfiles-CLAUDE.md');
    writeFileSync(real, 'x\n');
    symlinkSync(real, file());
    addReminder(file(), false);
    expect(readFileSync(real, 'utf8')).toBe(`x\n\n${BLOCK}`);
    expect(() => addReminder(home, false)).toThrow('not a regular file');
  });
});

describe('installClaudeHooks', () => {
  const file = () => join(home, '.claude', 'settings.json');

  it('adds both hooks, keeps other settings and hooks, and is idempotent', () => {
    mkdirSync(join(home, '.claude'));
    const other = { matcher: 'Bash', hooks: [{ type: 'command', command: 'guard.py' }] };
    writeFileSync(file(), JSON.stringify({ model: 'x', hooks: { PreToolUse: [other], Stop: [{ hooks: [{ type: 'command', command: 'mine' }] }] } }));
    expect(installClaudeHooks(file())).toBe('added');
    const s = JSON.parse(readFileSync(file(), 'utf8'));
    expect(s.model).toBe('x');
    expect(s.hooks.PreToolUse).toEqual([other]);
    expect(s.hooks.Stop).toEqual([
      { hooks: [{ type: 'command', command: 'mine' }] },
      { hooks: [{ type: 'command', command: 'codechart hook stop', timeout: 30 }] },
    ]);
    expect(s.hooks.UserPromptSubmit).toEqual([{ hooks: [{ type: 'command', command: 'codechart hook prompt', timeout: 10 }] }]);
    const text = readFileSync(file(), 'utf8');
    expect(installClaudeHooks(file())).toBe('present');
    expect(readFileSync(file(), 'utf8')).toBe(text);
  });

  it('creates settings.json when missing', () => {
    expect(installClaudeHooks(file())).toBe('added');
    expect(Object.keys(JSON.parse(readFileSync(file(), 'utf8')).hooks)).toEqual(['UserPromptSubmit', 'Stop']);
  });

  it('refuses invalid JSON or an unexpected shape without touching the file', () => {
    mkdirSync(join(home, '.claude'));
    writeFileSync(file(), '{ // comment\n}');
    expect(() => installClaudeHooks(file())).toThrow('not valid JSON');
    writeFileSync(file(), '{"hooks": []}');
    expect(() => installClaudeHooks(file())).toThrow('"hooks" is not an object');
    expect(readFileSync(file(), 'utf8')).toBe('{"hooks": []}');
  });
});

describe('install-skill --reminder / --hook', () => {
  beforeEach(() => {
    mkdirSync(join(home, '.claude'));
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
  });

  it('--reminder writes each agent its instructions file; --hook writes Claude Code settings', async () => {
    const r = await run(['install-skill', '--agent', 'claude,opencode', '--reminder', '--hook']);
    expect(r.code).toBeUndefined();
    expect(readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8')).toBe(BLOCK);
    expect(readFileSync(join(home, '.config', 'opencode', 'AGENTS.md'), 'utf8')).toBe(BLOCK);
    expect(r.out).toContain(`reminder added: ${join(home, '.claude', 'CLAUDE.md')}\n`);
    expect(r.out).toContain(`hook added: ${join(home, '.claude', 'settings.json')}\n`);
  });

  it('without flags, offers both unchecked and installs only what was picked', async () => {
    let offered: { title: string; labels: string[]; checked?: boolean } | undefined;
    const choose = async (title: string, items: { label: string; hint: string }[], checked?: boolean) => {
      if (checked !== false) return items.map((_, i) => i);
      offered = { title, labels: items.map((i) => i.label), checked };
      return [1];
    };
    const r = await run(['install-skill'], '', choose);
    expect(offered).toEqual({ title: 'Optional: help agents remember to use codechart', labels: ['Reminder line', 'Claude Code hook'], checked: false });
    expect(r.out).toContain('hook added');
    expect(r.out).not.toContain('reminder');
  });

  it('without a terminal and without flags, adds nothing', async () => {
    const r = await run(['install-skill', '--agent', 'claude']);
    expect(r.out).not.toMatch(/reminder|hook/);
  });

  it('the hook is not offered when Claude Code is not picked', async () => {
    let labels: string[] = [];
    await run(['install-skill'], '', async (_, items, checked) => {
      if (checked === false) labels = items.map((i) => i.label);
      return checked === false ? [] : [items.findIndex((i) => i.label === 'OpenCode')];
    });
    expect(labels).toEqual(['Reminder line']);
  });

  it('--agent asks nothing: extras come only from their flags', async () => {
    let asked = false;
    const r = await run(['install-skill', '--agent', 'claude'], '', async () => {
      asked = true;
      return [0, 1];
    });
    expect(asked).toBe(false);
    expect(r.out).not.toMatch(/reminder|hook/);
  });
});

describe('changedFiles', () => {
  it('counts files whose content changed, appeared or went away, plus files of commits made in between', () => {
    const before = { head: 'a', files: { 'same.ts': 'h1', 'edited.ts': 'h1', 'committed.ts': 'h1' } };
    const now = { head: 'b', files: { 'same.ts': 'h1', 'edited.ts': 'h2', 'new.ts': 'h3' } };
    expect(changedFiles({ files: {} }, { head: 'b', files: {} }, (a, b) => (a === undefined && b === 'b' ? ['first.ts'] : []))).toEqual(['first.ts']);
    expect(changedFiles(before, now, (a, b) => (a === 'a' && b === 'b' ? ['in-commit.ts'] : []))).toEqual([
      'committed.ts',
      'edited.ts',
      'in-commit.ts',
      'new.ts',
    ]);
  });
});

describe('turnUsedCodechart', () => {
  const line = (o: unknown) => JSON.stringify(o);
  const prompt = line({ type: 'user', message: { content: 'do it' } });
  const toolResult = line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } });
  const text = (t: string) => line({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });
  const bash = (command: string) => line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });

  it('a map or flow block in this turn counts', () => {
    expect(turnUsedCodechart([prompt, toolResult, text('**Map** _(key: …)_')].join('\n'))).toBe(true);
    expect(turnUsedCodechart([prompt, text('**Flow** _(key: …)_')].join('\n'))).toBe(true);
  });

  it('running codechart check or render counts, even when it drew nothing', () => {
    expect(turnUsedCodechart([prompt, bash("git diff; codechart check --git")].join('\n'))).toBe(true);
  });

  it('only this turn: a map before the last prompt does not count', () => {
    expect(turnUsedCodechart([prompt, text('**Map**'), prompt, text('done')].join('\n'))).toBe(false);
  });

  it('tool results and a cut first line do not reset or break it', () => {
    expect(turnUsedCodechart(['{"type":"assis', prompt, text('**Map**'), toolResult].join('\n'))).toBe(true);
  });
});

describe('codechart hook', () => {
  const sh = (...args: string[]) => git(repo, ...args);
  const input = (extra: Record<string, unknown> = {}) => JSON.stringify({ session_id: 's1', cwd: repo, ...extra });
  const write = (...files: string[]) => files.forEach((f) => writeFileSync(join(repo, f), `${f} ${Math.random()}\n`));

  beforeEach(() => {
    gitInit(repo);
    write('a.ts', 'b.ts', 'c.ts', 'mine.ts');
    sh('add', '.');
    sh('commit', '-q', '-m', 'init');
    write('mine.ts');
  });

  it('asks for a diagram when the turn changed 3+ files and nothing used codechart', async () => {
    expect((await run(['hook', 'prompt'], input())).out).toBe('');
    write('a.ts', 'b.ts', 'new.ts');
    const r = await run(['hook', 'stop'], input({ last_assistant_message: 'Done: added new.ts.' }));
    const out = JSON.parse(r.out);
    expect(out.hookSpecificOutput.hookEventName).toBe('Stop');
    expect(out.hookSpecificOutput.additionalContext).toContain('This turn changed 3 files and your reply has no codechart diagram.');
    expect(out.hookSpecificOutput.additionalContext).not.toContain('a.ts');
    expect(r.code).toBeUndefined();
  });

  it('stays quiet under 3 files, ignoring files already changed before the turn', async () => {
    await run(['hook', 'prompt'], input());
    write('a.ts', 'b.ts');
    expect((await run(['hook', 'stop'], input())).out).toBe('');
  });

  it('counts files committed during the turn', async () => {
    await run(['hook', 'prompt'], input());
    write('a.ts', 'b.ts', 'c.ts');
    sh('commit', '-q', '-m', 'turn', 'a.ts', 'b.ts', 'c.ts');
    expect(JSON.parse((await run(['hook', 'stop'], input())).out).hookSpecificOutput.additionalContext).toContain('changed 3 files');
  });

  it("counts the files of a repo's first commit made during the turn", async () => {
    rmSync(join(repo, '.git'), { recursive: true, force: true });
    rmSync(join(repo, 'mine.ts'));
    gitInit(repo);
    rmSync(join(repo, 'a.ts'));
    rmSync(join(repo, 'b.ts'));
    rmSync(join(repo, 'c.ts'));
    await run(['hook', 'prompt'], input());
    write('a.ts', 'b.ts', 'c.ts');
    sh('add', '.');
    sh('commit', '-q', '-m', 'first');
    expect(JSON.parse((await run(['hook', 'stop'], input())).out).hookSpecificOutput.additionalContext).toContain('changed 3 files');
  });

  it('asks only once per turn, and not when the reply has a diagram', async () => {
    await run(['hook', 'prompt'], input());
    write('a.ts', 'b.ts', 'c.ts');
    expect((await run(['hook', 'stop'], input({ stop_hook_active: true }))).out).toBe('');
    expect((await run(['hook', 'stop'], input({ last_assistant_message: '**Map** _(key)_' }))).out).toBe('');
    const transcript = join(tmp, 't.jsonl');
    writeFileSync(transcript, [JSON.stringify({ type: 'user', message: { content: 'go' } }), JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '**Map** _(key)_' }] } })].join('\n'));
    expect((await run(['hook', 'stop'], input({ transcript_path: transcript }))).out).toBe('');
  });

  it('never fails: no snapshot, bad input, outside a repo', async () => {
    for (const stdin of [input(), 'not json', JSON.stringify({ session_id: '../x', cwd: repo }), JSON.stringify({ session_id: 's', cwd: tmp })]) {
      const r = await run(['hook', 'stop'], stdin);
      expect(r).toEqual({ out: '', err: '', code: undefined });
    }
  });
});

describe('codechart hook failures', () => {
  const failing = async (env: NodeJS.ProcessEnv) => {
    let err = '';
    const program = buildProgram({ cwd: repo, home, env, stdin: async () => 'not json', stdout: () => {}, stderr: (s) => (err += s) });
    await runProgram(program, ['hook', 'stop'], 'user');
    return { err, code: process.exitCode };
  };

  it('says why on stderr only when CODECHART_DEBUG is set, and still exits cleanly', async () => {
    expect(await failing({})).toEqual({ err: '', code: undefined });
    const r = await failing({ CODECHART_DEBUG: '1' });
    expect(r.err).toMatch(/^codechart: hook stop: .*JSON/);
    expect(r.code).toBeUndefined();
  });
});

describe('removing what install-skill added', () => {
  it('removeReminder takes the block and the blank line before it, nothing else', () => {
    const file = join(home, 'CLAUDE.md');
    writeFileSync(file, '# mine\n- a rule\n');
    addReminder(file, false);
    writeFileSync(file, `${readFileSync(file, 'utf8')}after\n`);
    expect(removeReminder(file)).toBe('removed');
    expect(readFileSync(file, 'utf8')).toBe('# mine\n- a rule\nafter\n');
    expect(removeReminder(file)).toBe('absent');
    expect(removeReminder(join(home, 'missing.md'))).toBe('absent');
  });

  it('removeClaudeHooks keeps other hooks and drops what it empties', () => {
    const file = join(home, 'settings.json');
    const other = { matcher: 'Bash', hooks: [{ type: 'command', command: 'guard.py' }] };
    writeFileSync(file, JSON.stringify({ model: 'x', hooks: { PreToolUse: [other], Stop: [{ hooks: [{ type: 'command', command: 'mine' }] }] } }));
    installClaudeHooks(file);
    expect(removeClaudeHooks(file)).toBe('removed');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ model: 'x', hooks: { PreToolUse: [other], Stop: [{ hooks: [{ type: 'command', command: 'mine' }] }] } });
    expect(removeClaudeHooks(file)).toBe('absent');
    writeFileSync(file, '{"model":"x"}');
    installClaudeHooks(file);
    removeClaudeHooks(file);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ model: 'x' });
  });

  it('uninstall removes the skill, reminders and hooks; keeps files that are not its own', async () => {
    mkdirSync(join(home, '.claude'));
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
    await run(['install-skill', '--agent', 'claude,opencode', '--reminder', '--hook']);
    await run(['install-skill', '--agent', 'codex']);
    writeFileSync(join(home, '.agents', 'skills', 'codechart', 'notes.txt'), 'mine');
    mkdirSync(join(home, '.config', 'opencode', 'skills', 'codechart'), { recursive: true });
    writeFileSync(join(home, '.config', 'opencode', 'skills', 'codechart', 'SKILL.md'), '---\nname: other\n---\n');
    const r = await run(['uninstall']);
    expect(r.code).toBeUndefined();
    expect(existsSync(join(home, '.claude', 'skills', 'codechart'))).toBe(false);
    expect(readFileSync(join(home, '.agents', 'skills', 'codechart', 'notes.txt'), 'utf8')).toBe('mine');
    expect(existsSync(join(home, '.agents', 'skills', 'codechart', 'SKILL.md'))).toBe(false);
    expect(readFileSync(join(home, '.config', 'opencode', 'skills', 'codechart', 'SKILL.md'), 'utf8')).toContain('name: other');
    expect(readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8')).toBe('');
    expect(JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'))).toEqual({});
    expect(r.out).toContain(`removed skill: ${join(home, '.claude', 'skills', 'codechart')}`);
    expect(r.out).toContain('kept your other files there');
    expect(r.out).toContain('not the codechart skill');
    expect(r.out).toContain(`removed hook: ${join(home, '.claude', 'settings.json')}`);
    expect((await run(['uninstall', '--hook'])).out).toBe('nothing to remove\n');
  });

  it('uninstall --reminder touches only reminders', async () => {
    mkdirSync(join(home, '.claude'));
    await run(['install-skill', '--agent', 'claude', '--reminder']);
    const r = await run(['uninstall', '--reminder']);
    expect(r.out).toBe(`removed reminder: ${join(home, '.claude', 'CLAUDE.md')}\n`);
    expect(existsSync(join(home, '.claude', 'skills', 'codechart', 'SKILL.md'))).toBe(true);
  });
});
