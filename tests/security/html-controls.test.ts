import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { businessPage } from '../../src/render/business/html.js';
import { esc } from '../../src/render/web/page.js';
import { validateBusinessSpec } from '../../src/spec/business.js';
import { business } from '../fixtures/business.js';
import { makeSandbox, removeSandbox, runCli } from '../helpers/sandbox.js';

const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

let tmp: string;
let repo: string;
let outDir: string;

beforeEach(() => {
  ({ tmp, repo, out: outDir } = makeSandbox('html-controls', { git: 'dir', htmlOut: true }));
});

afterEach(() => removeSandbox(tmp));

const run = (args: string[], stdin = '') => runCli({ cwd: repo, home: join(tmp, 'home'), stdin: async () => stdin, isTTY: false }, args);

const spec = (label: string, path = 'src/a.ts') => ({
  title: 't', kind: 'plan', edges: [],
  nodes: [{ id: 'a', label, kind: 'other', status: 'new', layer: 'l', path }],
});

describe('S-38 control characters in HTML', () => {
  it('esc drops C0, DEL and C1, keeps \\n and \\t', () => {
    expect(esc('a\u001b[2J\u0000\u007f\u009bb\n\tc')).toBe('a[2Jb\n\tc');
  });

  it('a node path with ESC/NUL reaches the page without them', async () => {
    await run(['render', '-', '--output', 'web'], JSON.stringify(spec('x', 'src/\u001b]0;pwn\u0007\u0000a.ts')));
    const dir = join(outDir, readdirSync(outDir)[0]!);
    const html = readFileSync(join(dir, readdirSync(dir)[0]!), 'utf8');
    expect(html).toContain('src/]0;pwna.ts');
    expect(html).not.toMatch(CTRL);
  });

  it('a business page drops controls from every word it shows', () => {
    const r = validateBusinessSpec(business());
    if (!r.ok) throw new Error('fixture');
    const dirty = '\u001b]0;pwn\u0007\u0000x';
    const html = businessPage({ ...r.spec, title: dirty, summary: dirty, rules: [{ ...r.spec.rules[0]!, name: dirty, after: dirty }], questions: [] }, { generatedAt: new Date(0), repo: 'r' });
    expect(html).toContain(']0;pwnx');
    expect(html).not.toMatch(CTRL);
  });
});
