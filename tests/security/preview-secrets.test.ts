import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkMapNodes, diffOf } from '../../src/render/check.js';
import { nodePreviews } from '../../src/render/preview.js';
import { diffRange, gitFiles } from '../../src/rules/selection.js';
import type { Spec } from '../../src/spec/schema.js';
import { repoFromTemplate } from '../helpers/sandbox.js';

let tmp: string;
let repo: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();

function seed(dir: string) {
  writeFileSync(join(dir, 'seed'), 'x');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: dir });
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-secret-'));
  repo = join(tmp, 'repo');
  mkdirSync(repo);
  repoFromTemplate(repo, seed);
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

  it('hides an edit deep inside a key block, with BEGIN outside the hunk', () => {
    const body = Array.from({ length: 20 }, (_, i) => `KEYLINE${i}`);
    const key = (lines: string[]) => `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`;
    writeFileSync(join(repo, 'notes.txt'), key(body));
    git('add', '-A');
    git('commit', '-q', '-m', 'k');
    writeFileSync(join(repo, 'notes.txt'), key(body.map((l, i) => (i === 10 ? 'EDITED' : l))));
    expect(git('diff', '-U3', '--', 'notes.txt')).not.toContain('BEGIN');
    expect(previewOf('notes.txt')).toMatchObject({ note: 'not shown: looks like a secret', lines: [] });
  });

  it('hides an edit deep inside a key block in a commit', () => {
    const body = Array.from({ length: 20 }, (_, i) => `KEYLINE${i}`);
    const key = (lines: string[]) => `-----BEGIN RSA PRIVATE KEY-----\n${lines.join('\n')}\n-----END RSA PRIVATE KEY-----\n`;
    writeFileSync(join(repo, 'notes.txt'), key(body));
    git('add', '-A');
    git('commit', '-q', '-m', 'k');
    writeFileSync(join(repo, 'notes.txt'), key(body.map((l, i) => (i === 10 ? 'EDITED' : l))));
    git('commit', '-q', '-am', 'edit');
    const spec: Spec = { title: 't', kind: 'summary', edges: [], nodes: [{ id: 'n', label: 'n', kind: 'file', layer: 'l', status: 'changed', path: 'notes.txt' }] };
    const sel = { commit: 'HEAD' };
    const p = nodePreviews(spec, repo, diffOf(gitFiles(repo, sel, true)), diffRange(repo, sel), checkMapNodes(spec, repo, {}).found).get('n');
    expect(p?.note).toBe('not shown: looks like a secret');
  });
});

describe('S-34 follow-up: encoded files and the read budget', () => {
  it('hides a key in a UTF-16 working-tree-encoding file (git decodes it, the raw read does not)', () => {
    writeFileSync(join(repo, '.gitattributes'), 'notes.txt working-tree-encoding=UTF-16LE\n');
    const key = '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----\n';
    writeFileSync(join(repo, 'notes.txt'), Buffer.from(key, 'utf16le'));
    git('add', '-A');
    expect(previewOf('notes.txt')?.note).toBe('not shown: looks like a secret');
  });

  it('whole-file reads count against the 25 MB render budget', () => {
    const files = ['a.txt', 'b.txt', 'c.txt'];
    for (const f of files) writeFileSync(join(repo, f), 'a\n'.repeat(2_250_000));
    git('add', '-A');
    git('commit', '-q', '-m', 'big');
    for (const f of files) writeFileSync(join(repo, f), `b\n${'a\n'.repeat(2_249_999)}`);
    const spec: Spec = {
      title: 't',
      kind: 'summary',
      edges: [],
      nodes: files.map((f, i) => ({ id: `n${i}`, label: f, kind: 'file', layer: 'l', status: 'changed', path: f })),
    };
    const sel = { git: true };
    const p = nodePreviews(spec, repo, diffOf(gitFiles(repo, sel, true)), diffRange(repo, sel), checkMapNodes(spec, repo, {}).found);
    expect(p.get('n0')?.lines.length).toBeGreaterThan(0);
    expect(p.get('n2')?.note).toBe('not shown: the diffs pass 25 MB together');
  });
});

describe('S-30 follow-up: a diff attribute does not lift the size cap', () => {
  it('a big file marked `diff` in .gitattributes is not diffed', () => {
    writeFileSync(join(repo, '.gitattributes'), '*.txt diff\n');
    writeFileSync(join(repo, 'big.txt'), 'a\n'.repeat(3_000_000));
    git('add', '-A');
    git('commit', '-q', '-m', 'big');
    writeFileSync(join(repo, 'big.txt'), `b\n${'a\n'.repeat(2_999_999)}`);
    const p = previewOf('big.txt');
    expect(p?.note).toBe('diff is too large (over 5 MB)');
    expect(p?.lines).toEqual([]);
  });
});
