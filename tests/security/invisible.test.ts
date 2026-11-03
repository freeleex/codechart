import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { esc } from '../../src/render/web/page.js';
import { flat } from '../../src/render/terminal/wrap.js';
import { escapeJsonControls, hasHiddenChars, sanitizeText } from '../../src/render/strip.js';
import { makeSandbox, removeSandbox, runCli } from '../helpers/sandbox.js';

const TAGS = '\u{e0041}\u{e0042}\u{e007f}';
const HIDDEN = '\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b\u180e\u3164\ufe00\ufe0e\uffa0\ufff9\ufffb\u{e0000}\u{e0100}\u{e01ef}';
const RAW = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u3164\ufe00-\ufe0e\uffa0\ufff9-\ufffb\u2028\u2029\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/u;

let tmp: string;
let repo: string;
let outDir: string;

beforeEach(() => {
  ({ tmp, repo, out: outDir } = makeSandbox('invisible', { git: 'dir', htmlOut: true }));
});

afterEach(() => removeSandbox(tmp));

const run = (args: string[], stdin = '') => runCli({ cwd: repo, home: join(tmp, 'home'), stdin: async () => stdin, isTTY: false }, args);

const spec = (label: string, path = 'src/a.ts') => ({
  title: 't', kind: 'plan', edges: [],
  nodes: [{ id: 'a', label, kind: 'other', status: 'new', layer: 'l', path }],
});

describe('S-35 Unicode tags and other invisible characters', () => {
  it('flat, esc and sanitizeText strip them', () => {
    expect(flat(`a${TAGS}${HIDDEN}b`)).toBe('ab');
    expect(esc(`a${TAGS}${HIDDEN}b`)).toBe('ab');
    expect(sanitizeText(`a${TAGS}${HIDDEN}b`)).toBe('ab');
  });

  it('keeps ZWJ emoji sequences and VS16', () => {
    const s = '\u{1F468}\u200d\u{1F469} \u2764\ufe0f';
    expect(flat(s)).toBe(s);
    expect(esc(s)).toBe(s);
  });

  it('hasHiddenChars flags them', () => {
    for (const c of [...TAGS, ...HIDDEN]) expect(hasHiddenChars(`a${c}b`), c.codePointAt(0)!.toString(16)).toBe(true);
    expect(hasHiddenChars('plain \u2764\ufe0f')).toBe(false);
  });

  it('escapeJsonControls escapes them, plus U+2028/9', () => {
    const json = escapeJsonControls(JSON.stringify({ k: `a${TAGS}${HIDDEN}\u2028\u2029b` }));
    expect(json).not.toMatch(RAW);
    expect(json).toContain('\\udb40\\udc41');
    expect(JSON.parse(json).k).toBe(`a${TAGS}${HIDDEN}\u2028\u2029b`);
  });

  it('labels with tag chars: terminal, markdown and HTML outputs carry none', async () => {
    const label = `hello${TAGS}world`;
    for (const args of [['render', '-', '--output', 'cli'], ['render', '-', '--output', 'cli', '--md']]) {
      const r = await run(args, JSON.stringify(spec(label)));
      expect(r.out).toContain('helloworld');
      expect(r.out).not.toMatch(RAW);
    }
    await run(['render', '-', '--output', 'web'], JSON.stringify(spec(label)));
    const html = readFileSync(join(outDir, readdirSync(outDir)[0]!, readdirSync(join(outDir, readdirSync(outDir)[0]!))[0]!), 'utf8');
    expect(html).toContain('helloworld');
    expect(html).not.toMatch(RAW);
  });

  it('check JSON escapes tag chars in file names', async () => {
    writeFileSync(join(repo, '.codechart.yaml'), 'rules:\n  - name: x\n    paths: ["src/**"]\n');
    const r = await run(['check', '--files', `src/a${TAGS}.ts`]);
    expect(r.out).not.toMatch(RAW);
  });

  it('stderr is sanitised', async () => {
    const r = await run(['render', `no${TAGS}such.json`]);
    expect(r.err).not.toMatch(RAW);
  });
});
