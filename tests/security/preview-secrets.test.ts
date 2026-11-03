import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkMapNodes, diffOf } from '../../src/render/check.js';
import { nodePreviews } from '../../src/render/preview.js';
import { diffRange, gitFiles } from '../../src/rules/selection.js';
import type { Spec } from '../../src/spec/schema.js';

let tmp: string;
let repo: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-secret-'));
  repo = join(tmp, 'repo');
  mkdirSync(repo);
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'seed'), 'x');
  git('add', '-A');
  git('commit', '-q', '-m', 'seed');
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const previewOf = (path: string) => {
  const spec: Spec = { title: 't', kind: 'summary', edges: [], nodes: [{ id: 'n', label: 'n', kind: 'file', layer: 'l', status: 'new', path }] };
  const sel = { git: true };
  return nodePreviews(spec, repo, diffOf(gitFiles(repo, sel, true)), diffRange(repo, sel), checkMapNodes(spec, repo, {}).found).get('n');
};

describe('S-34 secret files in the preview', () => {
  it.each(['.env', '.env.local', 'cfg/server.pem', 'a.key', 'x.p12', 'x.pfx', 'id_rsa', 'id_ed25519.pub', '.npmrc', '.netrc', '.pypirc', 'aws-credentials.json'])(
    'hides %s by name',
    (name) => {
      mkdirSync(join(repo, 'cfg'), { recursive: true });
      writeFileSync(join(repo, name), 'TOKEN=hunter2\n');
      const p = previewOf(name);
      expect(p?.note).toBe('not shown: looks like a secret');
      expect(p?.lines).toEqual([]);
    },
  );

  it.each(['.env.example', '.env.sample', '.env.template'])('still shows %s', (name) => {
    writeFileSync(join(repo, name), 'TOKEN=\n');
    expect(previewOf(name)?.lines.length).toBeGreaterThan(0);
  });

  it('hides a file holding a private key block', () => {
    writeFileSync(join(repo, 'notes.txt'), '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n');
    expect(previewOf('notes.txt')).toMatchObject({ note: 'not shown: looks like a secret', lines: [] });
  });

  it('hides a tracked file whose diff adds a private key block', () => {
    writeFileSync(join(repo, 'k.txt'), 'one\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'k');
    writeFileSync(join(repo, 'k.txt'), 'one\n-----BEGIN RSA PRIVATE KEY-----\n');
    expect(previewOf('k.txt')?.note).toBe('not shown: looks like a secret');
  });
});
