import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram, runProgram } from '../../src/program.js';
import { esc } from '../../src/render/web/page.js';

const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

let tmp: string;
let repo: string;
let outDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-invis-'));
  repo = join(tmp, 'repo');
  outDir = join(tmp, 'out');
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(tmp, 'home', '.config', 'codechart'), { recursive: true });
  writeFileSync(join(tmp, 'home', '.config', 'codechart', 'config.yaml'), `web:\n  outDir: ${outDir}\n`);
  process.exitCode = undefined;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.exitCode = undefined;
});

async function run(args: string[], stdin = '') {
  let out = '';
  let err = '';
  const program = buildProgram({
    cwd: repo, home: join(tmp, 'home'), env: {}, stdout: (s) => (out += s), stderr: (s) => (err += s), stdin: async () => stdin, isTTY: false,
  });
  await runProgram(program, args, 'user');
  return { out, err };
}

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
});
