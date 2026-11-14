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

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'codechart-toolenv-'));
    log = join(dir, 'seen.txt');
    const script = `#!/bin/sh
for v in ${TOKENS.join(' ')}; do
  eval "val=\\\${$v-__unset__}"
  [ "$val" = "__unset__" ] || echo "$v" >> '${log}'
done
echo '{"title":"t","body":"b","description":"d"}'
`;
    for (const name of ['gh', 'glab']) {
      writeFileSync(join(dir, name), script);
      chmodSync(join(dir, name), 0o755);
    }
    writeFileSync(log, '');
    vi.stubEnv('PATH', `${dir}:${process.env.PATH ?? ''}`);
    for (const t of TOKENS) vi.stubEnv(t, `fake_${t.toLowerCase()}`);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const seen = () => readFileSync(log, 'utf8').split('\n').filter(Boolean);

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

  it('setup-pr-maps --pr: the same rule applies to its tool', () => {
    const tool = makeTool();
    tool('gh', ['pr', 'list'], 'github.evil.example');
    tool('glab', ['mr', 'list'], 'gitlab.evil.example');
    expect(seen()).toEqual([]);
    tool('gh', ['pr', 'list'], 'github.com');
    expect(seen()).toEqual(TOKENS);
  });
});
