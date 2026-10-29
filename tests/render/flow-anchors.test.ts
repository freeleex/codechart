import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkFlowAnchors } from '../../src/render/flow/anchors.js';
import { type FlowSpec, validateFlowSpec } from '../../src/spec/flow.js';

let base: string;
let repo: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'codechart-anchors-'));
  repo = join(base, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  writeFileSync(join(repo, 'src/a.ts'), Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  writeFileSync(join(base, 'secret.txt'), 'secret TOPSECRET\n');
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const spec = (source: string, linkSource?: string): FlowSpec => ({
  diagram: 'flow',
  kind: 'summary',
  title: 't',
  start: 's',
  steps: [{ id: 's', label: 'a step', type: 'step', status: 'existing', source }],
  links: linkSource ? [{ from: 's', to: 's', source: linkSource }] : [],
});

const errorsOf = (s: FlowSpec) => {
  const r = checkFlowAnchors(s, repo);
  if (r.ok) throw new Error('expected errors');
  return r.errors;
};

describe('checkFlowAnchors', () => {
  it('returns a snippet for a valid anchor', () => {
    const r = checkFlowAnchors(spec('src/a.ts:3-4'), repo);
    expect(r).toEqual({
      ok: true,
      snippets: { steps: new Map([['s', { source: 'src/a.ts:3-4', startLine: 3, lines: ['line 3', 'line 4'] }]]), links: {} },
    });
  });

  it('caps snippets at 15 lines and handles a single line', () => {
    const r = checkFlowAnchors(spec('src/a.ts:2-20', 'src/a.ts:20'), repo);
    if (!r.ok) throw new Error('expected ok');
    expect(r.snippets.steps.get('s')!.lines).toHaveLength(15);
    expect(r.snippets.steps.get('s')!.lines[0]).toBe('line 2');
    expect(r.snippets.links[0]).toEqual({ source: 'src/a.ts:20', startLine: 20, lines: ['line 20'] });
  });

  it('reports a missing file', () => {
    expect(errorsOf(spec('src/nope.ts:1'))).toEqual([`steps[0].source: src/nope.ts:1 not found (file does not exist; repo root is ${repo})`]);
  });

  it('reports each anchor into the same missing file by its own source', () => {
    expect(errorsOf(spec('src/nope.ts:1', 'src/nope.ts:2'))).toEqual([
      `steps[0].source: src/nope.ts:1 not found (file does not exist; repo root is ${repo})`,
      `links[0].source: src/nope.ts:2 not found (file does not exist; repo root is ${repo})`,
    ]);
  });

  it('reports a range out of bounds', () => {
    expect(errorsOf(spec('src/a.ts:18-21'))).toEqual(['steps[0].source: src/a.ts:18-21 not found (file has 20 lines)']);
  });

  it('reports a reversed range', () => {
    expect(errorsOf(spec('src/a.ts:5-3'))).toEqual(['steps[0].source: src/a.ts:5-3 not found (start is after end)']);
  });

  it('reports line 0', () => {
    expect(errorsOf(spec('src/a.ts:0'))[0]).toContain('lines start at 1');
  });

  it('checks link anchors', () => {
    expect(errorsOf(spec('src/a.ts:1', 'src/a.ts:99'))).toEqual(['links[0].source: src/a.ts:99 not found (file has 20 lines)']);
  });

  it('rejects absolute paths', () => {
    expect(errorsOf(spec(`${join(base, 'secret.txt')}:1`))).toEqual([`steps[0].source: ${join(base, 'secret.txt')} is outside the repo`]);
  });

  it('rejects .. escapes', () => {
    expect(errorsOf(spec('../secret.txt:1'))).toEqual(['steps[0].source: ../secret.txt is outside the repo']);
  });

  it('rejects symlinks leaving the root', () => {
    symlinkSync(join(base, 'secret.txt'), join(repo, 'src/link.txt'));
    expect(errorsOf(spec('src/link.txt:1', 'src/link.txt:1'))).toEqual([
      'steps[0].source: src/link.txt is outside the repo',
      'links[0].source: src/link.txt is outside the repo',
    ]);
  });

  it('allows symlinks that stay inside the root', () => {
    symlinkSync(join(repo, 'src/a.ts'), join(repo, 'src/in.ts'));
    expect(checkFlowAnchors(spec('src/in.ts:1'), repo).ok).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('rejects a FIFO without blocking', () => {
    execFileSync('mkfifo', [join(repo, 'src/fifo')]);
    expect(errorsOf(spec('src/fifo:1'))).toEqual(['steps[0].source: src/fifo is not a regular file']);
  });

  it('rejects a directory', () => {
    expect(errorsOf(spec('src:1'))).toEqual(['steps[0].source: src is not a regular file']);
  });

  it('rejects a file over 5 MB', () => {
    writeFileSync(join(repo, 'src/big.txt'), 'x'.repeat(5 * 1024 * 1024 + 1));
    expect(errorsOf(spec('src/big.txt:1'))).toEqual(['steps[0].source: src/big.txt is too large (over 5 MB)']);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('keeps the real reason a file cannot be read', () => {
    chmodSync(join(repo, 'src/a.ts'), 0o000);
    expect(errorsOf(spec('src/a.ts:1'))).toEqual(['steps[0].source: src/a.ts cannot be read (EACCES)']);
  });

  it('accepts a repo path starting with ..', () => {
    mkdirSync(join(repo, '..data'));
    writeFileSync(join(repo, '..data/x.ts'), 'x\n');
    expect(checkFlowAnchors(spec('..data/x.ts:1'), repo).ok).toBe(true);
  });

  it('rejects a path through a symlinked parent dir leaving the root', () => {
    symlinkSync(base, join(repo, 'src/up'));
    expect(errorsOf(spec('src/up/secret.txt:1'))).toEqual(['steps[0].source: src/up/secret.txt is outside the repo']);
  });

  it('rejects src/../../ escapes', () => {
    expect(errorsOf(spec('src/../../secret.txt:1'))).toEqual(['steps[0].source: src/../../secret.txt is outside the repo']);
  });
});

describe('anchors inside .git (S-20)', () => {
  it.each(['.git/config:1', './.git/config:1', 'src/../.git/config:1'])('%s -> rejected, config not read', (source) => {
    expect(errorsOf(spec(source))).toEqual([`steps[0].source: ${source.slice(0, -2)} is inside .git`]);
  });

  it('a symlink into .git -> rejected', () => {
    symlinkSync(join(repo, '.git', 'config'), join(repo, 'src', 'cfg'));
    expect(errorsOf(spec('src/cfg:1'))).toEqual(['steps[0].source: src/cfg is inside .git']);
  });

  it('.github and .gitignore are fine', () => {
    mkdirSync(join(repo, '.github'));
    writeFileSync(join(repo, '.github', 'ci.yml'), 'x\n');
    writeFileSync(join(repo, '.gitignore'), 'x\n');
    expect(checkFlowAnchors(spec('.github/ci.yml:1', '.gitignore:1'), repo).ok).toBe(true);
  });
});

describe('content anchors (source + match)', () => {
  const matched = (source: string, match: string, link?: { source: string; match?: string }): FlowSpec => ({
    ...spec(source),
    steps: [{ id: 's', label: 'a step', type: 'step', status: 'existing', source, match }],
    links: link ? [{ from: 's', to: 's', ...link }] : [],
  });

  it('resolves a unique match to its line', () => {
    const r = checkFlowAnchors(matched('src/a.ts', '  line 7 ', { source: 'src/a.ts', match: 'line 12' }), repo);
    expect(r).toEqual({
      ok: true,
      snippets: {
        steps: new Map([['s', { source: 'src/a.ts:7', startLine: 7, lines: ['line 7'] }]]),
        links: { 0: { source: 'src/a.ts:12', startLine: 12, lines: ['line 12'] } },
      },
    });
  });

  it('the ambiguous-match hint, applied literally, gives a valid spec', () => {
    const step = { id: 's', label: 'a step', status: 'existing', source: 'src/a.ts', match: 'line 2' };
    const base = { kind: 'summary', title: 't', start: 's', links: [] };
    expect(validateFlowSpec({ ...base, steps: [step] }).ok).toBe(true);
    const err = errorsOf(matched('src/a.ts', 'line 2'))[0]!;
    const source = /drop match and use source '([^']+)'/.exec(err)![1]!;
    const applied = { id: 's', label: 'a step', status: 'existing', source };
    expect(validateFlowSpec({ ...base, steps: [applied] }).ok).toBe(true);
    const r = checkFlowAnchors(spec(source), repo);
    expect(r.ok).toBe(true);
  });

  it('reports text not found', () => {
    expect(errorsOf(matched('src/a.ts', 'nope'))).toEqual(['steps[0].match: "nope" not found in src/a.ts']);
  });

  it('reports an ambiguous match with the line numbers', () => {
    expect(errorsOf(matched('src/a.ts', 'line 1'))).toEqual([
      'steps[0].match: "line 1" is on 11 lines of src/a.ts (1, 10, 11, 12, 13, 14, 15, 16, 17, 18 and 1 more); quote a more distinctive piece of the line or drop match and use source \'src/a.ts:1\'',
    ]);
    expect(errorsOf(matched('src/a.ts', 'line 2', { source: 'src/a.ts', match: 'ne 2' }))).toEqual([
      'steps[0].match: "line 2" is on 2 lines of src/a.ts (2, 20); quote a more distinctive piece of the line or drop match and use source \'src/a.ts:2\'',
      'links[0].match: "ne 2" is on 2 lines of src/a.ts (2, 20); quote a more distinctive piece of the line or drop match and use source \'src/a.ts:2\'',
    ]);
  });

  it('does not treat match as a regex', () => {
    writeFileSync(join(repo, 'src/r.ts'), 'a.b\naxb\n');
    const r = checkFlowAnchors(matched('src/r.ts', 'a.b'), repo);
    expect(r.ok && r.snippets.steps.get('s')!.startLine).toBe(1);
  });

  it('matches across CRLF line ends', () => {
    writeFileSync(join(repo, 'src/w.ts'), 'one\r\ntwo\r\n');
    const r = checkFlowAnchors(matched('src/w.ts', 'two'), repo);
    expect(r.ok && r.snippets.steps.get('s')).toEqual({ source: 'src/w.ts:2', startLine: 2, lines: ['two'] });
  });

  it('reports a missing file', () => {
    expect(errorsOf(matched('src/nope.ts', 'x'))).toEqual([`steps[0].source: src/nope.ts not found (file does not exist; repo root is ${repo})`]);
  });

  it('keeps the sandbox: outside, .git, symlink out, directory, size', () => {
    symlinkSync(join(base, 'secret.txt'), join(repo, 'src/link.txt'));
    writeFileSync(join(repo, 'src/big.txt'), 'x'.repeat(5 * 1024 * 1024 + 1));
    const cases: [string, string][] = [
      ['../secret.txt', 'steps[0].source: ../secret.txt is outside the repo'],
      [join(base, 'secret.txt'), `steps[0].source: ${join(base, 'secret.txt')} is outside the repo`],
      ['.git/config', 'steps[0].source: .git/config is inside .git'],
      ['src/link.txt', 'steps[0].source: src/link.txt is outside the repo'],
      ['src', 'steps[0].source: src is not a regular file'],
      ['src/big.txt', 'steps[0].source: src/big.txt is too large (over 5 MB)'],
    ];
    for (const [source, error] of cases) {
      const errors = errorsOf(matched(source, 'secret'));
      expect(errors).toEqual([error]);
      expect(errors.join('\n')).not.toContain('TOPSECRET');
    }
  });

  it('matches a tab-indented line', () => {
    writeFileSync(join(repo, 'src/t.go'), 'func f() {\n\treturn nil\n}\n');
    const r = checkFlowAnchors(matched('src/t.go', '\treturn nil'), repo);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(r.snippets.steps.get('s')).toEqual({ source: 'src/t.go:2', startLine: 2, lines: ['\treturn nil'] });
  });

  it('caps a snippet line at 300 characters', () => {
    writeFileSync(join(repo, 'src/min.js'), `var a=1;${'x'.repeat(1000)}\n`);
    const byMatch = checkFlowAnchors(matched('src/min.js', 'var a=1;'), repo);
    const byLine = checkFlowAnchors(spec('src/min.js:1'), repo);
    for (const r of [byMatch, byLine]) {
      if (!r.ok) throw new Error(r.errors.join('\n'));
      expect(r.snippets.steps.get('s')!.lines).toEqual([`var a=1;${'x'.repeat(292)}…`]);
    }
  });
});

describe('paths relative to the working directory', () => {
  const inSrc = (s: FlowSpec) => checkFlowAnchors(s, repo, undefined, join(repo, 'src'));
  const failsInSrc = (s: FlowSpec) => {
    const r = inSrc(s);
    if (r.ok) throw new Error('expected errors');
    return r.errors;
  };
  const matched = (source: string, match: string): FlowSpec => ({
    ...spec(source),
    steps: [{ id: 's', label: 'a step', type: 'step', status: 'existing', source, match }],
  });

  it('accepts a cwd-relative path and normalises it to the repo root', () => {
    const r = inSrc({ ...spec('a.ts:3-4', 'a.ts:5') });
    expect(r).toEqual({
      ok: true,
      snippets: {
        steps: new Map([['s', { source: 'src/a.ts:3-4', startLine: 3, lines: ['line 3', 'line 4'] }]]),
        links: { 0: { source: 'src/a.ts:5', startLine: 5, lines: ['line 5'] } },
      },
    });
  });

  it('normalises a match anchor and a ../ path', () => {
    const r = inSrc(matched('a.ts', 'line 7'));
    expect(r.ok && r.snippets.steps.get('s')!.source).toBe('src/a.ts:7');
    const up = inSrc(matched('../src/a.ts', 'line 7'));
    expect(up.ok && up.snippets.steps.get('s')!.source).toBe('src/a.ts:7');
  });

  it('prefers the repo-root path when both exist', () => {
    writeFileSync(join(repo, 'a.ts'), 'root a\n');
    const r = inSrc(spec('a.ts:1'));
    expect(r.ok && r.snippets.steps.get('s')!.lines).toEqual(['root a']);
  });

  it('names the repo root and the likely path when neither exists', () => {
    expect(failsInSrc(spec('b.ts:1'))).toEqual([`steps[0].source: b.ts:1 not found (file does not exist; repo root is ${repo})`]);
    mkdirSync(join(repo, 'pkg/src'), { recursive: true });
    writeFileSync(join(repo, 'pkg/src/c.ts'), 'c\n');
    execFileSync('git', ['add', 'pkg'], { cwd: repo });
    expect(errorsOf(spec('src/c.ts:1'))).toEqual([
      `steps[0].source: src/c.ts:1 not found (file does not exist; repo root is ${repo}; did you mean pkg/src/c.ts)`,
    ]);
  });

  it('suggests tracked files only, and matches Windows-style input', () => {
    mkdirSync(join(repo, 'pkg/src'), { recursive: true });
    writeFileSync(join(repo, 'pkg/src/c.ts'), 'c\n');
    expect(errorsOf(spec('src/c.ts:1'))[0]).not.toContain('did you mean');
    execFileSync('git', ['add', 'pkg'], { cwd: repo });
    expect(errorsOf(spec('src\\c.ts:1'))[0]).toContain('did you mean pkg/src/c.ts');
  });

  it('suggests nothing when several files fit', () => {
    mkdirSync(join(repo, 'a/src'), { recursive: true });
    mkdirSync(join(repo, 'b/src'), { recursive: true });
    writeFileSync(join(repo, 'a/src/c.ts'), 'c\n');
    writeFileSync(join(repo, 'b/src/c.ts'), 'c\n');
    execFileSync('git', ['add', 'a', 'b'], { cwd: repo });
    expect(errorsOf(spec('src/c.ts:1'))[0]).not.toContain('did you mean');
  });

  it('keeps the sandbox for cwd-relative paths', () => {
    symlinkSync(join(base, 'secret.txt'), join(repo, 'src/link.txt'));
    expect(failsInSrc(spec('link.txt:1'))).toEqual(['steps[0].source: src/link.txt is outside the repo']);
    expect(failsInSrc(spec('../../secret.txt:1'))).toEqual(['steps[0].source: ../../secret.txt is outside the repo']);
    expect(failsInSrc(spec('../.git/config:1'))).toEqual(['steps[0].source: .git/config is inside .git']);
    expect(failsInSrc(spec(`${join(base, 'secret.txt')}:1`))).toEqual([`steps[0].source: ${join(base, 'secret.txt')} is outside the repo`]);
  });

  it('rejects a cwd outside the repo', () => {
    const r = checkFlowAnchors(spec('secret.txt:1'), repo, undefined, base);
    expect(r.ok).toBe(false);
  });
});
