import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { branchVersion } from '../../src/commands/release-branch.js';
import { repoFolder } from '../../src/render/output-path.js';
import { git, makeSandbox, removeSandbox, runCli, type Sandbox } from '../helpers/sandbox.js';

let sb: Sandbox;

beforeEach(() => {
  sb = makeSandbox('release-branch', { htmlOut: true, git: 'init' });
  writeFileSync(join(sb.repo, 'a.ts'), 'x');
  git(sb.repo, 'add', '.');
  git(sb.repo, 'commit', '-q', '-m', 'first');
});
afterEach(() => removeSandbox(sb.tmp));

const config = (release: object) => writeFileSync(join(sb.repo, '.codechart.yaml'), JSON.stringify({ release }));
const on = (branch: string) => git(sb.repo, 'checkout', '-q', '-B', branch);

async function release(...extra: string[]): Promise<unknown> {
  const r = await runCli({ cwd: sb.repo, home: sb.home, isTTY: false }, ['check', '--files', 'a.ts', ...extra]);
  expect(r.err).toBe('');
  return (JSON.parse(r.out) as { release?: unknown }).release;
}

describe('branchVersion', () => {
  it.each([
    ['v1.2.0', '1.2.0'],
    ['release-0.8.0', '0.8.0'],
    ['release/2.1', '2.1'],
    ['release-v2.1.3', '2.1.3'],
    ['release-1.2.0-rc.1', '1.2.0'],
    ['release', undefined],
    ['release-candidate', undefined],
    ['v2', undefined],
    ['release-20261109', undefined],
  ])('%s -> %s', (branch, version) => expect(branchVersion(branch)).toBe(version));
});

describe('check on release branches', () => {
  it.each([
    ['v1.2.0', '1.2.0'],
    ['release-0.8.0', '0.8.0'],
    ['release/2.1', '2.1'],
  ])('%s matches the default patterns and suggests', async (branch, version) => {
    on(branch);
    expect(await release()).toEqual({ action: 'suggest', branch, version });
  });

  it('has no version key when the branch name has none', async () => {
    on('release-candidate');
    expect(await release()).toEqual({ action: 'suggest', branch: 'release-candidate' });
  });

  it('adds no release key on another branch, nor on a detached HEAD', async () => {
    on('feat/refunds');
    expect(await release()).toBeUndefined();
    on('validate-input');
    expect(await release()).toBeUndefined();
    git(sb.repo, 'checkout', '-q', '--detach');
    expect(await release()).toBeUndefined();
  });

  it('keeps the rest of the output as it was', async () => {
    on('main');
    const plain = await runCli({ cwd: sb.repo, home: sb.home, isTTY: false }, ['check', '--files', 'a.ts']);
    on('release-1.0.0');
    const onRelease = await runCli({ cwd: sb.repo, home: sb.home, isTTY: false }, ['check', '--files', 'a.ts']);
    const { release: hint, ...rest } = JSON.parse(onRelease.out);
    expect(hint).toBeDefined();
    expect(rest).toEqual(JSON.parse(plain.out));
  });

  it('uses release.branches instead of the defaults', async () => {
    config({ branches: ['ship/*'] });
    on('release-1.0.0');
    expect(await release()).toBeUndefined();
    on('ship/3.0');
    expect(await release()).toEqual({ action: 'suggest', branch: 'ship/3.0', version: '3.0' });
  });

  it('release.auto off stays quiet', async () => {
    config({ auto: 'off' });
    on('release-1.0.0');
    expect(await release()).toBeUndefined();
  });

  it('--head names the branch to look at instead of the checked out one', async () => {
    on('main');
    git(sb.repo, 'branch', 'release-4.0.0');
    const r = await runCli({ cwd: sb.repo, home: sb.home, isTTY: false }, ['check', '--since', 'HEAD', '--head', 'release-4.0.0']);
    expect(r.err).toBe('');
    expect(JSON.parse(r.out).release).toEqual({ action: 'suggest', branch: 'release-4.0.0', version: '4.0.0' });
    git(sb.repo, 'update-ref', 'refs/remotes/origin/release-4.0.0', 'HEAD');
    const remote = await runCli({ cwd: sb.repo, home: sb.home, isTTY: false }, ['check', '--since', 'HEAD', '--head', 'origin/release-4.0.0']);
    expect(JSON.parse(remote.out).release?.branch).toBe('release-4.0.0');
  });

  describe('release.auto draw', () => {
    const cache = () => join(sb.out, repoFolder(sb.repo));
    const save = (name: string) => {
      mkdirSync(cache(), { recursive: true });
      writeFileSync(join(cache(), name), '');
      return join(cache(), name);
    };

    beforeEach(() => {
      config({ auto: 'draw' });
      on('release-2.0.0');
    });

    it('says draw until the release was drawn', async () => {
      expect(await release()).toEqual({ action: 'draw', branch: 'release-2.0.0', version: '2.0.0' });
      save('20261109-100000-v1-9-0-what-is-new.release.pdf');
      expect(await release()).toMatchObject({ action: 'draw' });
    });

    it('says done with the PDF path once it was, whichever way the version is written', async () => {
      const pdf = save('20261109-100000-v2-0-0-what-is-new-in-shop-2-0.release.pdf');
      save('20261109-100000-v2-0-0-what-is-new-in-shop-2-0.release.html');
      expect(await release()).toEqual({ action: 'done', branch: 'release-2.0.0', version: '2.0.0', path: pdf });
    });

    it('falls back to the page when the PDF is gone, and takes the newest one', async () => {
      save('20261101-100000-v2-0-0-older.release.html');
      const page = save('20261109-100000-v2-0-0-newer.release.html');
      expect(await release()).toMatchObject({ action: 'done', path: page });
    });

    it('does not take a business page or a map for a release', async () => {
      save('20261109-100000-v2-0-0-what-is-new.business.html');
      save('20261109-100000-v2-0-0-what-is-new.html');
      expect(await release()).toMatchObject({ action: 'draw' });
    });

    it('without a version in the branch name it only suggests, so it never redraws on every check', async () => {
      on('release-candidate');
      save('20261109-100000-v2-0-0-what-is-new.release.pdf');
      expect(await release()).toEqual({ action: 'suggest', branch: 'release-candidate' });
    });

    it('suggest never says done', async () => {
      config({ auto: 'suggest' });
      save('20261109-100000-v2-0-0-what-is-new.release.pdf');
      expect(await release()).toMatchObject({ action: 'suggest' });
    });
  });
});
