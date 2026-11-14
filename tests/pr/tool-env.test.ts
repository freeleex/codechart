import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTool } from '../../src/commands/setup-pr-maps.js';
import { fetchPr, runTool } from '../../src/pr/merged.js';
import { parseRemote } from '../../src/pr/setup.js';

const TOKENS = ['GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN'];

describe.skipIf(process.platform === 'win32')('gh and glab environment per host', () => {
  let dir: string;
  let log: string;
  let argsLog: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'codechart-toolenv-'));
    log = join(dir, 'seen.txt');
    argsLog = join(dir, 'args.txt');
    const script = `#!/bin/sh
for v in ${TOKENS.join(' ')}; do
  eval "val=\\\${$v-__unset__}"
  [ "$val" = "__unset__" ] || echo "$v" >> '${log}'
done
echo "$*" >> '${argsLog}'
echo '{"title":"t","body":"b","description":"d"}'
`;
    for (const name of ['gh', 'glab']) {
      writeFileSync(join(dir, name), script);
      chmodSync(join(dir, name), 0o755);
    }
    writeFileSync(log, '');
    writeFileSync(argsLog, '');
    vi.stubEnv('PATH', `${dir}:${process.env.PATH ?? ''}`);
    for (const t of TOKENS) vi.stubEnv(t, `fake_${t.toLowerCase()}`);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const seen = () => readFileSync(log, 'utf8').split('\n').filter(Boolean);
  const repoArgs = () => readFileSync(argsLog, 'utf8').split('\n').filter(Boolean).map((l) => /--repo (\S+)/.exec(l)?.[1]);

  it('a GitHub path naming another host is refused: gh never gets a --repo with that host, nor the tokens', () => {
    for (const url of ['git@github.com:github.evil.example/o/r.git', 'https://github.com/github.evil.example/o/r.git', 'git@github.com:o/r/extra.git', 'git@github.com:/o/r.git']) {
      const remote = parseRemote(url);
      if (remote) fetchPr(runTool, remote, 1);
      expect(remote).toBeUndefined();
    }
    expect(repoArgs()).toEqual([]);
    expect(seen()).toEqual([]);
  });

  it('github.com owner/repo: --repo names github.com itself, tokens kept', () => {
    fetchPr(runTool, parseRemote('git@github.com:o/r.git')!, 1);
    expect(repoArgs()).toEqual(['github.com/o/r']);
    expect(seen()).toEqual(TOKENS);
  });

  it('GitLab nested groups still work on gitlab.com and self-managed hosts', () => {
    fetchPr(runTool, parseRemote('https://gitlab.com/group/sub/repo.git')!, 1);
    expect(seen()).toEqual(TOKENS);
    fetchPr(runTool, parseRemote('git@gitlab.example.com:group/sub/repo.git')!, 1);
    expect(repoArgs()).toEqual(['https://gitlab.com/group/sub/repo', 'https://gitlab.example.com/group/sub/repo']);
  });

  it('a GitLab path that tries to name another host is refused', () => {
    for (const url of ['git@gitlab.com://evil.example/o/r.git', 'ssh://git@gitlab.com/@evil.example/o/r.git', 'git@gitlab.com:evil.example:8080/o/r.git', 'git@gitlab.com:o/../../evil.example/r.git', 'git@gitlab.com:\\\\evil.example/o/r.git', 'git@gitlab.com:o.git']) {
      expect(parseRemote(url)).toBeUndefined();
    }
  });

  it('release-context: a look-alike GitHub host gets none of the token variables', () => {
    const remote = parseRemote('git@github.evil.example:o/r.git')!;
    expect(fetchPr(runTool, remote, 1).title).toBe('t');
    expect(seen()).toEqual([]);
  });

  it('release-context: github.com still gets them', () => {
    fetchPr(runTool, parseRemote('git@github.com:o/r.git')!, 1);
    expect(seen()).toEqual(TOKENS);
  });

  it('release-context: a look-alike GitLab host gets none, gitlab.com still does', () => {
    fetchPr(runTool, parseRemote('git@gitlab.evil.example:o/r.git')!, 1);
    expect(seen()).toEqual([]);
    fetchPr(runTool, parseRemote('git@gitlab.com:o/r.git')!, 1);
    expect(seen()).toEqual(TOKENS);
  });

  it("GitHub's and GitLab's ssh-over-443 hosts are the real service: tokens kept, repo host is the web host", () => {
    for (const [url, host, server] of [
      ['ssh://git@ssh.github.com:443/o/r.git', 'github', 'github.com'],
      ['ssh://git@altssh.gitlab.com:443/o/r.git', 'gitlab', 'gitlab.com'],
    ] as const) {
      const remote = parseRemote(url)!;
      expect(remote).toEqual({ host, server, path: 'o/r' });
      fetchPr(runTool, remote, 1);
      expect(seen()).toEqual(TOKENS);
      writeFileSync(log, '');
    }
  });

  it('only those exact ssh host names count', () => {
    for (const url of ['ssh://git@ssh.github.com.evil.example:443/o/r.git', 'git@www.github.com:o/r.git', 'git@gist.github.com:o/r.git', 'ssh://git@altssh.gitlab.com.evil.example/o/r.git']) {
      fetchPr(runTool, parseRemote(url)!, 1);
      expect(seen()).toEqual([]);
    }
  });

  it('setup-pr-maps --pr: the same rule applies to its tool', () => {
    const tool = makeTool();
    tool('gh', ['pr', 'list'], 'github.evil.example');
    tool('glab', ['mr', 'list'], 'gitlab.evil.example');
    expect(seen()).toEqual([]);
    tool('gh', ['pr', 'list'], 'github.com');
    expect(seen()).toEqual(TOKENS);
  });
});
