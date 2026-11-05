import { existsSync, readFileSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    expect(git(sb.repo, 'status', '--porcelain')).toBe('?? wip.txt\n');
    expect(existsSync(workflow())).toBe(false);
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
    expect(r.out).toContain('would open a merge request on g/r that would append this job to .gitlab-ci.yml');
    const ci = git(remote, 'show', `${SETUP_BRANCH}:.gitlab-ci.yml`);
    expect(ci.startsWith('test:\n  script: [make]\n\n# codechart PR maps')).toBe(true);
    expect(calls[0]!.slice(0, 7)).toEqual(['glab', 'mr', 'create', '--source-branch', SETUP_BRANCH, '--target-branch', 'main']);
    expect(calls[0]!.join(' ')).toContain('CODECHART_GITLAB_TOKEN');
  });
});
