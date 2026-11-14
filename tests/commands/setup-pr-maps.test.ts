import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { makeTool } from '../../src/commands/setup-pr-maps.js';
import { gitRun } from '../../src/pr/git.js';
import { buildPlan, parseRemote, SETUP_BRANCH, type Remote } from '../../src/pr/setup.js';
import { git, makeSandbox, removeSandbox, runCli, type Sandbox } from '../helpers/sandbox.js';

const VERSION = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
const gh: Remote = { host: 'github', server: 'github.com', path: 'o/r' };
const gl: Remote = { host: 'gitlab', server: 'gitlab.example.com', path: 'g/sub/r' };

describe('parseRemote', () => {
  it('reads GitHub and GitLab from ssh, scp-style and https URLs', () => {
    expect(parseRemote('git@github.com:o/r.git')).toEqual(gh);
    expect(parseRemote('https://github.com/o/r')).toEqual(gh);
    expect(parseRemote('ssh://git@gitlab.example.com:2222/g/sub/r.git')).toEqual(gl);
    expect(parseRemote('https://gitlab.example.com/g/sub/r.git')).toEqual(gl);
  });

  it('needs --host when the server name says neither', () => {
    expect(parseRemote('git@git.example.com:o/r.git')).toBeUndefined();
    expect(parseRemote('git@git.example.com:o/r.git', 'gitlab')).toEqual({ host: 'gitlab', server: 'git.example.com', path: 'o/r' });
  });
});

describe('parseRemote with hidden characters', () => {
  it('refuses a URL with control bytes in the server or path', () => {
    expect(parseRemote('https://github.com/o/\u001b]0;x\u0007r.git')).toBeUndefined();
    expect(parseRemote('git@github.com:o/\u202er.git')).toBeUndefined();
    expect(parseRemote('git@git.example.com:o/\u001br.git', 'gitlab')).toBeUndefined();
  });
});

describe('buildPlan', () => {
  const none = () => undefined;

  it('GitHub: a new workflow running this codechart version, not @latest', () => {
    const plan = buildPlan(gh, '9.9.9', none)!;
    expect(plan.file).toBe('.github/workflows/codechart.yml');
    expect(plan.content).toContain('npx --yes codechart@9.9.9 pr-sync');
    expect(plan.content).not.toContain('@latest');
    expect(plan.notes.join('\n')).toContain('No secret to add');
  });

  it('GitLab: appends the job to an existing .gitlab-ci.yml and says how to add the token', () => {
    const plan = buildPlan(gl, '9.9.9', (f) => (f === '.gitlab-ci.yml' ? 'test:\n  script: [make]' : undefined))!;
    expect(plan.appended).toBe(true);
    expect(plan.content.startsWith('test:\n  script: [make]\n\n# codechart PR maps')).toBe(true);
    expect(plan.content).toContain('codechart@9.9.9 pr-sync');
    expect(plan.notes.join('\n')).toContain('https://gitlab.example.com/g/sub/r/-/settings/ci_cd');
  });

  it('GitLab: a file whose stages lack test gets the job in its first real stage', () => {
    const ci = (text: string) => (f: string) => (f === '.gitlab-ci.yml' ? text : undefined);
    const plan = buildPlan(gl, '9.9.9', ci('stages: [.pre, build, deploy]\nb:\n  stage: build\n  script: [make]\n'))!;
    expect(plan.added).toContain('codechart-map:\n  stage: "build"\n  image: node:22');
    expect(plan.content).toContain('codechart-map:\n  stage: "build"\n');
    expect(buildPlan(gl, '9.9.9', ci('stages: [build, test]\n'))!.added).not.toContain('stage:');
    expect(buildPlan(gl, '9.9.9', ci('b:\n  script: [make]\n'))!.added).not.toContain('stage:');
    expect(buildPlan(gl, '9.9.9', ci('stages: ["my stage"]\n'))!.added).toContain('  stage: "my stage"\n');
    expect(buildPlan(gl, '9.9.9', ci('stages: ["123"]\n'))!.added).toContain('  stage: "123"\n');
    expect(buildPlan(gl, '9.9.9', ci('stages: ["true"]\n'))!.added).toContain('  stage: "true"\n');
    expect(() => buildPlan(gl, '9.9.9', ci('stages: [.pre, .post]\n'))).toThrow('.gitlab-ci.yml lists no stage codechart');
  });

  it('GitLab: reads stages past a !reference tag without printing a YAML warning', () => {
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    try {
      const plan = buildPlan(gl, '9.9.9', (f) => (f === '.gitlab-ci.yml' ? 'stages: [build]\nb:\n  script: !reference [.x, script]\n' : undefined))!;
      expect(plan.added).toContain('  stage: "build"\n');
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('nothing to do when already set up', () => {
    expect(buildPlan(gh, '1.0.0', () => 'run: npx codechart@0.4.0 pr-sync')).toBeUndefined();
    expect(buildPlan(gl, '1.0.0', () => 'codechart-map:\n  script: [npx codechart@1 pr-sync]')).toBeUndefined();
  });

  it('never overwrites a file that is not codechart’s', () => {
    expect(() => buildPlan(gh, '1.0.0', () => 'name: other')).toThrow('.github/workflows/codechart.yml already exists');
    expect(() => buildPlan(gl, '1.0.0', () => 'codechart-map:\n  script: [echo]')).toThrow('.gitlab-ci.yml already exists');
  });
});

describe('codechart setup-pr-maps', () => {
  let sb: Sandbox;
  beforeEach(() => {
    sb = makeSandbox('setup-pr-maps', { git: 'init' });
    git(sb.repo, 'commit', '-q', '--allow-empty', '-m', 'base');
    git(sb.repo, 'remote', 'add', 'origin', 'git@github.com:o/r.git');
  });
  afterEach(() => removeSandbox(sb.tmp));

  const workflow = () => join(sb.repo, '.github', 'workflows', 'codechart.yml');
  const run = (args: string[], extra = {}) => runCli({ cwd: sb.repo, home: sb.home, ...extra }, ['setup-pr-maps', ...args]);

  it('off a terminal: shows the plan, changes nothing, says how to go ahead', async () => {
    const r = await run([]);
    expect(r.out).toContain('codechart setup-pr-maps would add .github/workflows/codechart.yml in your work tree (not committed):');
    expect(r.out).toContain(`npx --yes codechart@${VERSION} pr-sync`);
    expect(r.out).toContain('Nothing changed. To go ahead, run again with --yes');
    expect(existsSync(workflow())).toBe(false);
  });

  it('asks first, and writes only on yes, without committing', async () => {
    expect((await run([], { confirm: async () => false })).out).not.toContain('wrote');
    expect(existsSync(workflow())).toBe(false);
    const r = await run([], { confirm: async () => true });
    expect(r.out).toContain('codechart: wrote .github/workflows/codechart.yml. Review it, commit and push it.');
    expect(readFileSync(workflow(), 'utf8')).toContain(`codechart@${VERSION} pr-sync`);
    expect(git(sb.repo, 'status', '--porcelain')).toBe('?? .github/\n');
  });

  it('declining writes nothing and says nothing was written', async () => {
    const r = await run([], { confirm: async () => false });
    expect(r.out).toContain('codechart setup-pr-maps would add');
    expect(r.out).not.toContain('wrote');
    expect(r.err).toBe('');
    expect(r.code).toBeUndefined();
    expect(existsSync(join(sb.repo, '.github'))).toBe(false);
  });

  it('without an origin remote it fails with exit 1', async () => {
    git(sb.repo, 'remote', 'remove', 'origin');
    const r = await run(['--yes']);
    expect(r.err).toBe('codechart: no origin remote: PR maps need the repo on GitHub or GitLab\n');
    expect(r.code).toBe(1);
    expect(existsSync(join(sb.repo, '.github'))).toBe(false);
  });

  it('--yes writes without asking; a second run finds it set up', async () => {
    await run(['--yes']);
    expect(existsSync(workflow())).toBe(true);
    expect((await run(['--yes'])).out).toBe('codechart: PR maps are already set up in o/r.\n');
  });

  it('refuses a symlink in place of the workflow', async () => {
    mkdirSync(join(sb.repo, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(sb.tmp, 'elsewhere'), 'x');
    symlinkSync(join(sb.tmp, 'elsewhere'), workflow());
    const r = await run(['--yes']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('not a regular file; refusing to write it');
    expect(readFileSync(join(sb.tmp, 'elsewhere'), 'utf8')).toBe('x');
  });

  it.runIf(process.platform !== 'win32')('refuses a symlinked .github or .github/workflows and writes nothing outside the repo', async () => {
    const outside = join(sb.tmp, 'outside');
    mkdirSync(join(outside, 'workflows'), { recursive: true });
    symlinkSync(outside, join(sb.repo, '.github'));
    const r = await run(['--yes']);
    expect(r.code).toBe(1);
    expect(r.err).toBe('codechart: .github/workflows/codechart.yml: a parent folder is a symlink; refusing to write it\n');
    expect(readdirSync(join(outside, 'workflows'))).toEqual([]);
    unlinkSync(join(sb.repo, '.github'));
    mkdirSync(join(sb.repo, '.github'));
    symlinkSync(join(outside, 'workflows'), join(sb.repo, '.github', 'workflows'));
    const again = await run(['--yes']);
    expect(again.err).toContain('a parent folder is a symlink; refusing to write it');
    expect(readdirSync(join(outside, 'workflows'))).toEqual([]);
  });

  it('a workflow created while it asks is not overwritten', async () => {
    const theirs = async () => (mkdirSync(join(sb.repo, '.github', 'workflows'), { recursive: true }), writeFileSync(workflow(), 'mine'), true);
    const r = await run([], { confirm: theirs });
    expect(r.err).toBe('codechart: .github/workflows/codechart.yml: changed while codechart was running; run it again\n');
    expect(readFileSync(workflow(), 'utf8')).toBe('mine');
  });

  // symlinks need privileges on Windows runners, and O_NOFOLLOW doesn't exist there
  it('GitLab: a C1 control byte in a stage name is escaped in the output and the written file', async () => {
    git(sb.repo, 'remote', 'set-url', 'origin', 'git@gitlab.com:o/r.git');
    const name = 'ab\u009bcd';
    writeFileSync(join(sb.repo, '.gitlab-ci.yml'), `stages: [${JSON.stringify(name)}]\nb:\n  script: [make]\n`);
    const r = await run(['--yes']);
    const written = readFileSync(join(sb.repo, '.gitlab-ci.yml'), 'utf8');
    expect(/[\u0080-\u009f]/.test(r.out)).toBe(false);
    expect(/[\u0080-\u009f]/.test(written.slice(written.indexOf('codechart-map:')))).toBe(false);
    const job = (parse(written) as Record<string, { stage?: string }>)['codechart-map']!;
    expect(job.stage).toBe(name);
  });

  it.runIf(process.platform !== 'win32')('a .gitlab-ci.yml swapped for a symlink while it asks is not written through', async () => {
    git(sb.repo, 'remote', 'set-url', 'origin', 'git@gitlab.com:o/r.git');
    const ci = join(sb.repo, '.gitlab-ci.yml');
    const victim = join(sb.tmp, 'victim');
    writeFileSync(ci, 'test:\n  script: [make]\n');
    writeFileSync(victim, 'x');
    const swap = async () => (rmSync(ci), symlinkSync(victim, ci), true);
    const r = await run([], { confirm: swap });
    expect(r.err).toContain('changed while codechart was running');
    expect(readFileSync(victim, 'utf8')).toBe('x');
  });

  it('an origin URL with control bytes is refused and printed clean', async () => {
    git(sb.repo, 'remote', 'set-url', 'origin', 'https://github.com/o/\u001b]0;x\u0007r.git');
    const r = await run(['--yes']);
    expect(r.code).toBe(1);
    expect(r.err).toContain("can't tell which repo");
    expect(`${r.out}${r.err}`.replace(/\n/g, '')).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(existsSync(workflow())).toBe(false);
  });

  it('an origin path that is not owner/repo on GitHub is refused, also with --host', async () => {
    git(sb.repo, 'remote', 'set-url', 'origin', 'git@github.com:github.evil.example/o/r.git');
    for (const args of [['--yes'], ['--yes', '--host', 'github']]) {
      const r = await run(args);
      expect(r.code).toBe(1);
      expect(r.err).toContain("can't tell which repo git@github.com:github.evil.example/o/r.git names");
    }
    expect(existsSync(workflow())).toBe(false);
  });

  it('a remote that is neither GitHub nor GitLab needs --host', async () => {
    git(sb.repo, 'remote', 'set-url', 'origin', 'git@git.example.com:o/r.git');
    const r = await run(['--yes']);
    expect(r.err).toContain('add --host github or --host gitlab');
    expect((await run(['--yes', '--host', 'gitlab'])).out).toContain('wrote .gitlab-ci.yml');
  });

  it('--pr: commits on the default branch in a scratch index, pushes a branch, opens the PR; the work tree is untouched', async () => {
    const remote = join(sb.tmp, 'remote.git');
    git(sb.tmp, 'init', '-q', '--bare', '-b', 'main', remote);
    git(sb.repo, 'push', '-q', remote, 'HEAD:refs/heads/main');
    git(sb.repo, 'config', `url.${remote}.insteadOf`, 'git@github.com:o/r.git');
    writeFileSync(join(sb.repo, 'wip.txt'), 'uncommitted work');
    const calls: string[][] = [];
    const tool = (cmd: string, args: string[]) => (calls.push([cmd, ...args]), 'https://github.com/o/r/pull/7\n');
    const r = await run(['--pr', '--yes'], { tool });
    expect(r.out).toContain('would open a pull request on o/r that would add .github/workflows/codechart.yml');
    expect(r.out).toContain('codechart: opened https://github.com/o/r/pull/7');
    expect(git(remote, 'show', `${SETUP_BRANCH}:.github/workflows/codechart.yml`)).toContain(`codechart@${VERSION} pr-sync`);
    expect(git(remote, 'rev-parse', `${SETUP_BRANCH}~1`)).toBe(git(remote, 'rev-parse', 'main'));
    expect(calls[0]!.slice(0, 7)).toEqual(['gh', 'pr', 'create', '--base', 'main', '--head', SETUP_BRANCH]);
    expect(calls[0]!.join(' ')).toContain('Merge to turn PR maps on; close to say no.');
    expect(calls[0]!.slice(-2)).toEqual(['--repo', 'github.com/o/r']);
    expect(git(sb.repo, 'status', '--porcelain')).toBe('?? wip.txt\n');
    expect(existsSync(workflow())).toBe(false);
  });

  it('--pr a second time: says the setup PR exists instead of pushing again', async () => {
    const remote = join(sb.tmp, 'remote.git');
    git(sb.tmp, 'init', '-q', '--bare', '-b', 'main', remote);
    git(sb.repo, 'push', '-q', remote, 'HEAD:refs/heads/main');
    git(sb.repo, 'config', `url.${remote}.insteadOf`, 'git@github.com:o/r.git');
    await run(['--pr', '--yes'], { tool: () => 'https://github.com/o/r/pull/7\n' });
    const pushed = git(remote, 'rev-parse', SETUP_BRANCH);
    const calls: string[][] = [];
    const tool = (cmd: string, args: string[]) => (calls.push([cmd, ...args]), '[{"url":"https://github.com/o/r/pull/7"}]');
    const r = await run(['--pr', '--yes'], { tool });
    expect(r.err).toBe('');
    expect(r.out).toContain(
      'codechart: the setup pull request already exists: https://github.com/o/r/pull/7\nMerge it to turn PR maps on, or delete the codechart/pr-maps branch and run again for a new one.\n',
    );
    expect(calls).toEqual([['gh', 'pr', 'list', '--head', SETUP_BRANCH, '--state', 'all', '--limit', '1', '--json', 'url', '--repo', 'github.com/o/r']]);
    expect(git(remote, 'rev-parse', SETUP_BRANCH)).toBe(pushed);
    const unknown = await run(['--pr', '--yes'], { tool: () => '' });
    expect(unknown.out).toContain('the codechart/pr-maps branch already exists on origin, so the setup pull request was opened before');
  });

  it('a rejected git push says why, not just where it pushed to', () => {
    const remote = join(sb.tmp, 'remote.git');
    git(sb.tmp, 'init', '-q', '--bare', '-b', 'main', remote);
    git(sb.repo, 'push', '-q', remote, 'HEAD:refs/heads/main');
    git(sb.repo, 'commit', '-q', '--allow-empty', '-m', 'other');
    git(sb.repo, 'push', '-q', remote, 'HEAD:refs/heads/x');
    expect(() => gitRun(sb.repo, ['push', remote, 'HEAD~1:refs/heads/x'])).toThrow(/^git push failed: ! \[rejected\].*\(non-fast-forward\)$/);
  });

  // shell hooks need sh, which Windows runners may not run the same way
  it.runIf(process.platform !== 'win32')('a push a server hook declines gives the hook’s reason', () => {
    const remote = join(sb.tmp, 'remote.git');
    git(sb.tmp, 'init', '-q', '--bare', '-b', 'main', remote);
    writeFileSync(join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\necho "GitLab: Author not a member of team" >&2\nexit 1\n', { mode: 0o755 });
    expect(() => gitRun(sb.repo, ['push', remote, 'HEAD:refs/heads/x'])).toThrow(
      /^git push failed: ! \[remote rejected\].*\(pre-receive hook declined\); remote: GitLab: Author not a member of team$/,
    );
  });

  it('--pr on GitLab: appends the job to the default branch’s .gitlab-ci.yml and opens an MR with glab', async () => {
    const remote = join(sb.tmp, 'remote.git');
    git(sb.tmp, 'init', '-q', '--bare', '-b', 'main', remote);
    writeFileSync(join(sb.repo, '.gitlab-ci.yml'), 'test:\n  script: [make]\n');
    git(sb.repo, 'add', '.gitlab-ci.yml');
    git(sb.repo, 'commit', '-q', '-m', 'ci');
    git(sb.repo, 'push', '-q', remote, 'HEAD:refs/heads/main');
    git(sb.repo, 'remote', 'set-url', 'origin', 'git@gitlab.example.com:g/r.git');
    git(sb.repo, 'config', `url.${remote}.insteadOf`, 'git@gitlab.example.com:g/r.git');
    const calls: string[][] = [];
    const r = await run(['--pr', '--yes'], { tool: (cmd: string, args: string[]) => (calls.push([cmd, ...args]), 'https://gitlab.example.com/g/r/-/merge_requests/3') });
    expect(r.out).toContain('would open a merge request on g/r that would add this job to .gitlab-ci.yml');
    const ci = git(remote, 'show', `${SETUP_BRANCH}:.gitlab-ci.yml`);
    expect(ci.startsWith('test:\n  script: [make]\n\n# codechart PR maps')).toBe(true);
    expect(calls[0]!.slice(0, 7)).toEqual(['glab', 'mr', 'create', '--source-branch', SETUP_BRANCH, '--target-branch', 'main']);
    expect(calls[0]!.join(' ')).toContain('CODECHART_GITLAB_TOKEN');
    expect(calls[0]!.slice(-2)).toEqual(['--repo', 'https://gitlab.example.com/g/r']);
  });
});

describe('the tool that runs gh/glab', () => {
  it('on Windows runs the .exe from an absolute PATH entry, never the bare name', () => {
    const calls: string[][] = [];
    const tool = makeTool({
      platform: 'win32',
      env: { PATH: '.;C:\\Tools' },
      exists: (p) => p === 'C:\\Tools\\gh.exe',
      exec: (file, args) => {
        calls.push([file, ...args]);
        return 'https://github.com/o/r/pull/1\n';
      },
    });
    expect(tool('gh', ['pr', 'create'])).toBe('https://github.com/o/r/pull/1\n');
    expect(calls).toEqual([['C:\\Tools\\gh.exe', 'pr', 'create']]);
  });

  it('on Windows a command off PATH is not installed, even with a repo-local file of that name', () => {
    const tool = makeTool({
      platform: 'win32',
      env: { PATH: '.;C:\\Tools' },
      exists: (p) => p === 'gh.exe',
      exec: () => {
        throw new Error('must not run');
      },
    });
    expect(() => tool('gh', ['pr', 'create'])).toThrow('gh is not installed; install it or run without --pr');
  });

  it('ENOENT from the run maps to the same message; other failures keep the stderr', () => {
    const win = { platform: 'win32' as const, env: { PATH: 'C:\\Tools' }, exists: (p: string) => p.endsWith('.exe') };
    const missing = makeTool({
      ...win,
      exec: () => {
        throw Object.assign(new Error('spawnSync gh ENOENT'), { code: 'ENOENT' });
      },
    });
    expect(() => missing('gh', [])).toThrow('gh is not installed; install it or run without --pr');
    const failed = makeTool({
      ...win,
      exec: () => {
        throw Object.assign(new Error('exit 1'), { stderr: 'boom\n' });
      },
    });
    expect(() => failed('glab', [])).toThrow('glab failed: boom');
  });
});
