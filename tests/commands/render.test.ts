import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram, runProgram, type ProgramOptions } from '../../src/program.js';
import { FLOW_KEY } from '../../src/render/flow/tree.js';
import { repoFolder } from '../../src/render/output-path.js';
import { sampleFlow } from '../render/flow-fixture.js';

let tmp: string;
let home: string;
let repo: string;
let out: string;
const now = new Date(2026, 9, 28, 9, 5, 3);

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-render-'));
  home = join(tmp, 'home');
  repo = join(tmp, 'myrepo');
  out = join(tmp, 'out');
  mkdirSync(home);
  mkdirSync(join(repo, '.git'), { recursive: true });
  config('');
  process.exitCode = undefined;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.exitCode = undefined;
});

function config(extra: string, dir = repo) {
  mkdirSync(join(home, '.config', 'codechart'), { recursive: true });
  writeFileSync(join(home, '.config', 'codechart', 'config.yaml'), `web:\n  outDir: ${out}\n`);
  writeFileSync(join(dir, '.codechart.yaml'), extra.startsWith('  ') ? `web:\n${extra}` : extra);
}

function spec(n: number, extra: Record<string, unknown> = {}) {
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    label: `node${i}`,
    kind: 'other',
    status: 'new',
    layer: 'l',
  }));
  const edges = nodes.slice(1).map((node, i) => ({ from: `n${i}`, to: node.id }));
  return { title: 'Teams table!!', kind: 'plan', nodes, edges, ...extra };
}

function specFile(content: unknown, dir = tmp): string {
  const file = join(dir, 'spec.json');
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

async function run(args: string[], opts: Partial<ProgramOptions> = {}) {
  let stdout = '';
  let stderr = '';
  const opened: string[] = [];
  const program = buildProgram({
    cwd: repo,
    home,
    env: {},
    stdout: (s) => (stdout += s),
    stderr: (s) => (stderr += s),
    now: () => now,
    isTTY: false,
    open: (p) => {
      opened.push(p);
    },
    ...opts,
  });
  await runProgram(program, args, 'user');
  return { out: stdout, err: stderr, code: process.exitCode, opened };
}

const repoOut = () => join(out, repoFolder(repo));
const written = () => (existsSync(repoOut()) ? readdirSync(repoOut()) : []);
const expectedFile = () => join(repoOut(), '20261028-090503-teams-table.html');

const HEADER = '**Map** _(key: + new  - removed  ~ changed  · context  ◆ config)_';

describe('codechart render', () => {
  it('invalid spec -> each error on stderr, exitCode 1, nothing written', async () => {
    const bad = spec(2);
    bad.edges.push({ from: 'n0', to: 'ghost' });
    bad.nodes[1]!.id = 'n0';
    const r = await run(['render', specFile(bad), '--output', 'both']);
    expect(r.code).toBe(1);
    expect(r.out).toBe('');
    expect(r.err).toContain('nodes[1].id: duplicate "n0"');
    expect(r.err).toContain('edges[1].to: unknown node "ghost"');
    expect(r.err.trim().split('\n')).toHaveLength(3);
    expect(existsSync(out)).toBe(false);
  });

  it('malformed JSON or missing file -> exitCode 1', async () => {
    const r1 = await run(['render', specFile('{nope')]);
    expect(r1.code).toBe(1);
    expect(r1.err).toMatch(/^codechart: /);
    process.exitCode = undefined;
    const r2 = await run(['render', join(tmp, 'missing.json')]);
    expect(r2.code).toBe(1);
    expect(r2.err).toContain('missing.json');
  });

  it("spec.rules ['db'] where db.output 'web' -> HTML written, stdout only \"full map → file://…\"", async () => {
    config('rules:\n  - name: db\n    paths: ["migrations/**"]\n    output: web\n');
    const r = await run(['render', specFile(spec(2, { rules: ['db'] }))]);
    expect(r.code).toBeUndefined();
    expect(written()).toHaveLength(1);
    expect(r.out).toBe(`full map → ${pathToFileURL(expectedFile()).href}\n`);
  });

  it('spec rule without own output inherits defaults.output', async () => {
    config('defaults:\n  output: web\nrules:\n  - name: db\n    paths: ["migrations/**"]\n');
    const r = await run(['render', specFile(spec(2, { rules: ['db'] }))]);
    expect(r.out).toMatch(/^full map → file:/);
  });

  it('unknown rule in spec -> stderr, exitCode 1, nothing written', async () => {
    const r = await run(['render', specFile(spec(2, { rules: ['nope'] }))]);
    expect(r.code).toBe(1);
    expect(r.err).toBe('codechart: unknown rule in spec: nope\n');
    expect(r.out).toBe('');
    expect(existsSync(out)).toBe(false);
  });

  it('unknown rule in spec fails even with --output override', async () => {
    const r = await run(['render', specFile(spec(2, { rules: ['nope'] })), '--output', 'web']);
    expect(r.code).toBe(1);
    expect(r.err).toBe('codechart: unknown rule in spec: nope\n');
    expect(existsSync(out)).toBe(false);
  });

  it("spec rules resolving to 'none' -> prints nothing, exit 0", async () => {
    config('rules:\n  - name: skip\n    paths: ["x/**"]\n    output: none\n');
    const r = await run(['render', specFile(spec(9, { rules: ['skip'] }))]);
    expect(r.code).toBeUndefined();
    expect(r.out).toBe('');
    expect(existsSync(out)).toBe(false);
  });

  it('--output cli overrides -> no HTML written, stdout has map', async () => {
    config('rules:\n  - name: db\n    paths: ["migrations/**"]\n    output: web\n');
    const r = await run(['render', specFile(spec(9, { rules: ['db'] })), '--output', 'cli']);
    expect(r.out).toContain('9 nodes · 9 new');
    expect(r.out).not.toContain('full map');
    expect(existsSync(out)).toBe(false);
  });

  it('fields section: shown with --output cli, absent with --output both', async () => {
    const withFields = spec(2);
    (withFields.nodes[0] as Record<string, unknown>).fields = [{ name: 'id', type: 'uuid' }];
    (withFields.nodes[0] as Record<string, unknown>).fieldsComplete = true;
    expect((await run(['render', specFile(withFields), '--output', 'cli'])).out).toContain('fields:\n+node0  id uuid');
    expect((await run(['render', specFile(withFields), '--output', 'both'])).out).not.toMatch(/^fields:$/m);
  });

  it('--output cli with hidden nodes -> "+N more not shown"', async () => {
    config('defaults:\n  terminalMaxNodes: 3\n');
    const r = await run(['render', specFile(spec(5)), '--output', 'cli']);
    expect(r.out).toContain('+2 more not shown');
  });

  it('no rules field -> defaults.output', async () => {
    config('defaults:\n  output: web\n');
    const r = await run(['render', specFile(spec(2))]);
    expect(r.out).toMatch(/^full map → file:/);
    expect(written()).toHaveLength(1);
  });

  it('--output both -> map plus link in footer', async () => {
    const r = await run(['render', specFile(spec(2)), '--output', 'both']);
    expect(r.out).toContain('2 nodes · 2 new');
    expect(r.out).toContain(`full map → ${pathToFileURL(expectedFile()).href}`);
  });

  it("reads spec from stdin when arg is '-'", async () => {
    const r = await run(['render', '-', '--output', 'cli'], { stdin: async () => JSON.stringify(spec(3)) });
    expect(r.code).toBeUndefined();
    expect(r.out).toContain('3 nodes · 3 new');
  });

  it('output path = <outDir>/<repo>/<YYYYMMDD-HHmmss>-<slug>.html, slug from title', async () => {
    await run(['render', specFile(spec(2)), '--output', 'web']);
    expect(existsSync(expectedFile())).toBe(true);
  });

  it('slug is at most 40 chars with no trailing dash; empty slug -> map', async () => {
    const title = 'A very long plan title that goes on - and on and on forever';
    await run(['render', specFile(spec(2, { title })), '--output', 'web']);
    expect(written()).toEqual(['20261028-090503-a-very-long-plan-title-that-goes-on-and.html']);
    rmSync(out, { recursive: true });
    await run(['render', specFile(spec(2, { title: '!!! ???' })), '--output', 'web']);
    expect(written()).toEqual(['20261028-090503-map.html']);
  });

  it('outside git -> repo = basename(cwd)', async () => {
    const plain = join(tmp, 'plain-dir');
    mkdirSync(plain);
    config('', plain);
    await run(['render', specFile(spec(2)), '--output', 'web'], { cwd: plain });
    expect(readdirSync(join(out, repoFolder(plain)))).toHaveLength(1);
  });

  it('same-named repos get separate HTML folders', async () => {
    const other = join(tmp, 'elsewhere', 'myrepo');
    mkdirSync(join(other, '.git'), { recursive: true });
    config('', other);
    await run(['render', specFile(spec(2)), '--output', 'web']);
    await run(['render', specFile(spec(2)), '--output', 'web'], { cwd: other });
    expect(repoFolder(other)).not.toBe(repoFolder(repo));
    expect(repoFolder(repo)).toMatch(/^myrepo-[0-9a-f]{8}$/);
    expect(written()).toHaveLength(1);
    expect(readdirSync(join(out, repoFolder(other)))).toHaveLength(1);
  });

  it('relative spec path resolves against cwd', async () => {
    specFile(spec(2), repo);
    const r = await run(['render', 'spec.json', '--output', 'cli']);
    expect(r.out).toContain('2 nodes');
  });

  it('output auto, 4-node spec -> no HTML written, no "full map" line', async () => {
    const r = await run(['render', specFile(spec(4))]);
    expect(r.out).toContain('4 nodes');
    expect(r.out).not.toContain('full map');
    expect(existsSync(out)).toBe(false);
  });

  it('output auto, spec with >= 8 nodes -> HTML written', async () => {
    const r = await run(['render', specFile(spec(8))]);
    expect(written()).toHaveLength(1);
    expect(r.out).toContain('8 nodes');
    expect(r.out).toContain('full map → file:');
  });

  it('output auto, terminalMaxNodes 3 on a 5-node spec (hidden > 0) -> HTML written', async () => {
    config('defaults:\n  terminalMaxNodes: 3\n');
    const r = await run(['render', specFile(spec(5))]);
    expect(written()).toHaveLength(1);
    expect(r.out).toContain('+2 more in web view');
  });

  describe('auto when the terminal map cuts text', () => {
    const labelled = (label: string) => {
      const s = spec(2);
      s.nodes[0]!.label = label;
      return s;
    };
    const long = 'a'.repeat(60);

    it('60-char source label at width 80 -> HTML written, footer links it', async () => {
      const r = await run(['render', specFile(labelled(long))]);
      expect(r.out).toContain('…');
      expect(r.out).toContain(`full map → ${pathToFileURL(expectedFile()).href}`);
      expect(written()).toHaveLength(1);
    });

    it('short labels -> no HTML', async () => {
      const r = await run(['render', specFile(labelled('short'))]);
      expect(r.out).not.toContain('full map');
      expect(existsSync(out)).toBe(false);
    });

    it('cli output cuts the label without writing HTML', async () => {
      const r = await run(['render', specFile(labelled(long)), '--output', 'cli']);
      expect(r.out).toContain('…');
      expect(r.out).not.toContain('full map');
      expect(existsSync(out)).toBe(false);
    });

    it('a label containing … that fits -> no HTML', async () => {
      const r = await run(['render', specFile(labelled('wait… what'))]);
      expect(r.out).toContain('wait… what');
      expect(existsSync(out)).toBe(false);
    });
  });

  it('web.minNodes from config drives auto', async () => {
    config('  minNodes: 3\n');
    const r = await run(['render', specFile(spec(3))]);
    expect(r.out).toContain('full map → file:');
  });

  it('re-render same title leaves one file', async () => {
    await run(['render', specFile(spec(2)), '--output', 'web'], { now: () => new Date(2026, 9, 28, 9, 0, 0) });
    await run(['render', specFile(spec(2)), '--output', 'web']);
    expect(written()).toEqual(['20261028-090503-teams-table.html']);
  });

  it('theme: config web.theme, overridden by --theme', async () => {
    config('  theme: light\n');
    await run(['render', specFile(spec(2)), '--output', 'web']);
    expect(readFileSync(expectedFile(), 'utf8')).toContain('data-theme="light"');
    await run(['render', specFile(spec(2)), '--output', 'web', '--theme', 'dark']);
    expect(readFileSync(expectedFile(), 'utf8')).toContain('data-theme="dark"');
  });

  it('--open passes the written path to the opener; no HTML -> not called', async () => {
    const r = await run(['render', specFile(spec(2)), '--output', 'web', '--open']);
    expect(r.opened).toEqual([expectedFile()]);
    const r2 = await run(['render', specFile(spec(2)), '--output', 'cli', '--open']);
    expect(r2.opened).toEqual([]);
  });

  it('web.open auto: opens new HTML inside VS Code-based editors only', async () => {
    const editor = await run(['render', specFile(spec(2)), '--output', 'web'], { env: { VSCODE_PID: '42' } });
    expect(editor.opened).toEqual([expectedFile()]);
    const vscodeTerm = await run(['render', specFile(spec(2)), '--output', 'web'], { env: { TERM_PROGRAM: 'vscode' } });
    expect(vscodeTerm.opened).toEqual([expectedFile()]);
    expect((await run(['render', specFile(spec(2)), '--output', 'web'])).opened).toEqual([]);
    expect((await run(['render', specFile(spec(2)), '--output', 'cli'], { env: { VSCODE_PID: '42' } })).opened).toEqual([]);
  });

  it('a failed browser open is reported on stderr; the link is still printed', async () => {
    const r = await run(['render', specFile(spec(2)), '--output', 'web', '--open'], { open: () => 'open exited with 1' });
    expect(r.err).toBe('codechart: could not open the browser (open exited with 1); open the link instead\n');
    expect(r.out).toContain('full map');
  });

  it('web.open never / always in the global config; ignored in a repo config', async () => {
    const globalOpen = (mode: string) => {
      mkdirSync(join(home, '.config', 'codechart'), { recursive: true });
      writeFileSync(join(home, '.config', 'codechart', 'config.yaml'), `web:\n  outDir: ${out}\n  open: ${mode}\n`);
    };
    globalOpen('never');
    expect((await run(['render', specFile(spec(2)), '--output', 'web'], { env: { VSCODE_PID: '42' } })).opened).toEqual([]);
    expect((await run(['render', specFile(spec(2)), '--output', 'web', '--open'], { env: { VSCODE_PID: '42' } })).opened).toEqual([expectedFile()]);
    globalOpen('always');
    expect((await run(['render', specFile(spec(2)), '--output', 'web'])).opened).toEqual([expectedFile()]);
    config('  open: always\n');
    const repoSet = await run(['render', specFile(spec(2)), '--output', 'web']);
    expect(repoSet.opened).toEqual([]);
    expect(repoSet.err).toContain('web.open are global-only; ignored');
  });

  it('color only when stdout is a TTY', async () => {
    const plain = await run(['render', specFile(spec(2)), '--output', 'cli']);
    expect(plain.out).not.toContain('\u001b[');
    const tty = await run(['render', specFile(spec(2)), '--output', 'cli'], { isTTY: true });
    expect(tty.out).toContain('\u001b[');
  });

  it('--md: Map label, text block, link outside the block when HTML is written', async () => {
    const plain = await run(['render', specFile(spec(2)), '--output', 'both']);
    const r = await run(['render', specFile(spec(2)), '--output', 'both', '--md']);
    const map = plain.out.split('\n').filter((l) => !l.startsWith('full map → ') && !l.startsWith('key: ')).join('\n');
    expect(r.out).toBe(`${HEADER}\n\`\`\`text\n${map}\`\`\`\n\n[Open full map](${pathToFileURL(expectedFile()).href})\n\n`);
    expect(r.out).not.toContain('full map →');
  });

  it('--md with output web', async () => {
    const r = await run(['render', specFile(spec(2)), '--output', 'web', '--md']);
    expect(r.out).toBe(`${HEADER}\n\n[Open full map](${pathToFileURL(expectedFile()).href})\n\n`);
  });

  it('--md without HTML: no link line', async () => {
    const plain = await run(['render', specFile(spec(2)), '--output', 'cli']);
    const r = await run(['render', specFile(spec(2)), '--output', 'cli', '--md']);
    expect(r.out).toBe(`${HEADER}\n\`\`\`text\n${plain.out.replace(/key: .*\n/, '')}\`\`\`\n\n`);
    expect(plain.out).toContain('key: + new');
    expect(written()).toEqual([]);
  });

  it('--md header has the italic key and no key line inside the block', async () => {
    const r = await run(['render', specFile(spec(2)), '--output', 'cli', '--md']);
    expect(r.out.split('\n')[0]).toBe(HEADER);
    expect(r.out.slice(r.out.indexOf('\n'))).not.toContain('key:');
  });

  it('--md never colored', async () => {
    const r = await run(['render', specFile(spec(2)), '--output', 'both', '--md'], { isTTY: true });
    expect(r.out).not.toContain('\u001b[');
  });

  it('--md link stays a valid markdown link for paths with spaces or parens', async () => {
    out = join(tmp, 'my out (1)');
    config('');
    const r = await run(['render', specFile(spec(2)), '--output', 'web', '--md']);
    const href = pathToFileURL(expectedFile()).href;
    expect(href).toContain('%20');
    expect(r.out).toBe(`${HEADER}\n\n[Open full map](${href.replace(/\(/g, '%28').replace(/\)/g, '%29')})\n\n`);
    out = join(tmp, 'my out');
    config('');
    const r2 = await run(['render', specFile(spec(2)), '--output', 'web', '--md']);
    expect(r2.out).toBe(`${HEADER}\n\n[Open full map](${pathToFileURL(expectedFile()).href})\n\n`);
  });

  it('--md fence grows past backticks in the map', async () => {
    const s = spec(2);
    s.nodes[0]!.label = 'a ``` b';
    const r = await run(['render', specFile(s), '--output', 'cli', '--md']);
    expect(r.out.startsWith(`${HEADER}\n\`\`\`\`text\n`)).toBe(true);
    expect(r.out.endsWith('\n````\n\n')).toBe(true);
  });

  it('HTML write failure -> exit 1, one "codechart: " line, no stack trace', async () => {
    writeFileSync(out, 'not a dir');
    const r = await run(['render', specFile(spec(2)), '--output', 'web']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^codechart: /);
    expect(r.err.trim().split('\n')).toHaveLength(1);
    expect(r.err).not.toContain('    at ');
  });

  it('non-Error throw -> "codechart: <value>"', async () => {
    const r = await run(['render', specFile(spec(2)), '--output', 'web', '--open'], {
      open: () => {
        throw 'boom';
      },
    });
    expect(r.code).toBe(1);
    expect(r.err).toBe('codechart: boom\n');
  });

  it('bad --output value -> usage error exit 2', async () => {
    const r = await run(['render', specFile(spec(2)), '--output', 'pdf']);
    expect(r.code).toBe(2);
  });
});

describe('codechart render (flow)', () => {
  const flowFile = () => join(repoOut(), '20261028-090503-render-flow.flow.html');

  beforeEach(() => {
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src', 'render.ts'), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n'));
  });

  it('end to end: tree on stdout, HTML with snippets written, link in footer', async () => {
    const r = await run(['render', specFile(sampleFlow()), '--output', 'both']);
    expect(r.code).toBeUndefined();
    expect(r.err).toBe('');
    expect(r.out).toContain('read file or stdin\n◇ output mode?\n├─ cli   → print terminal map');
    expect(r.out).toContain('5 steps · 0 new · 0 changed · 2 planned');
    expect(r.out).toContain(`full map → ${pathToFileURL(flowFile()).href}`);
    expect(written()).toEqual(['20261028-090503-render-flow.flow.html']);
    expect(readFileSync(flowFile(), 'utf8')).toContain('line 10');
  });

  it('anchors written relative to the cwd render with repo-root paths', async () => {
    const flow = sampleFlow();
    for (const st of flow.steps) if (st.source) st.source = st.source.replace('src/', '');
    for (const l of flow.links) if (l.source) l.source = l.source.replace('src/', '');
    const inSrc = { cwd: join(repo, 'src') };
    const r = await run(['render', specFile(flow), '--output', 'both'], inSrc);
    expect(r.err).toBe('');
    expect(readFileSync(flowFile(), 'utf8')).toContain('src/render.ts:10-12');
    expect(readFileSync(flowFile(), 'utf8')).not.toContain('>render.ts:10-12');
  });

  it('consecutive --md renders are separated by a blank line', async () => {
    const a = await run(['render', specFile(sampleFlow()), '--output', 'both', '--md']);
    const b = await run(['render', specFile(spec(2)), '--output', 'cli', '--md']);
    expect(a.out.endsWith(')\n\n')).toBe(true);
    expect(b.out.endsWith('```\n\n')).toBe(true);
  });

  it('auto: small flow prints the tree only; >= minNodes steps writes HTML', async () => {
    const small = await run(['render', specFile(sampleFlow())]);
    expect(small.out).toContain('◇ output mode?');
    expect(small.out).not.toContain('full map');
    expect(existsSync(out)).toBe(false);
    config('  minNodes: 5\n');
    const big = await run(['render', specFile(sampleFlow())]);
    expect(big.out).toContain('full map → file:');
    expect(written()).toHaveLength(1);
  });

  it('cli: a flow too large for terminalMaxNodes says so instead of printing nothing', async () => {
    config('defaults:\n  terminalMaxNodes: 1\n');
    const r = await run(['render', specFile(sampleFlow()), '--output', 'cli']);
    expect(r.out).toBe('flow too large for the terminal; use --output both or web\n');
    expect(written()).toEqual([]);
  });

  it('auto: pruned tree writes HTML and points the cut at the web view', async () => {
    config('defaults:\n  terminalMaxNodes: 3\n');
    const r = await run(['render', specFile(sampleFlow())]);
    expect(r.out).toContain('in web view');
    expect(written()).toHaveLength(1);
  });

  it('broken anchor -> each error on stderr, exitCode 1, nothing written', async () => {
    const flow = sampleFlow();
    flow.steps[0]!.source = 'src/render.ts:99';
    flow.links[1]!.source = 'src/nope.ts:1';
    const r = await run(['render', specFile(flow), '--output', 'both']);
    expect(r.code).toBe(1);
    expect(r.out).toBe('');
    expect(r.err).toBe(
      'steps[0].source: src/render.ts:99 not found (file has 30 lines)\n' +
        `links[1].source: src/nope.ts:1 not found (file does not exist; repo root is ${repo})\n`,
    );
    expect(existsSync(out)).toBe(false);
  });

  it('broken anchor fails before output resolution, even when output is none', async () => {
    config('defaults:\n  output: none\n');
    const flow = sampleFlow();
    flow.steps[0]!.source = '../outside.ts:1';
    const r = await run(['render', specFile(flow)]);
    expect(r.code).toBe(1);
    expect(r.err).toBe('steps[0].source: ../outside.ts is outside the repo\n');
  });

  it('--md: Flow header, tree in a text block, link outside it', async () => {
    const plain = await run(['render', specFile(sampleFlow()), '--output', 'both']);
    const r = await run(['render', specFile(sampleFlow()), '--output', 'both', '--md'], { isTTY: true });
    const tree = plain.out.split('\n').filter((l) => !l.startsWith('full map → ') && !l.startsWith('key: ')).join('\n');
    const link = `[Open full map](${pathToFileURL(flowFile()).href})`;
    expect(r.out).toBe(`**Flow** _(${FLOW_KEY})_\n\`\`\`text\nrender flow\n───────────\n${tree}\`\`\`\n\n${link}\n\n`);
  });

  it('--md with output web: header, title block and link', async () => {
    const r = await run(['render', specFile(sampleFlow()), '--output', 'web', '--md']);
    expect(r.out).toBe(`**Flow** _(${FLOW_KEY})_\n\`\`\`text\nrender flow\n───────────\n\`\`\`\n\n[Open full map](${pathToFileURL(flowFile()).href})\n\n`);
  });

  it('output web without --md prints only the link; --open gets the path', async () => {
    const r = await run(['render', specFile(sampleFlow()), '--output', 'web', '--open']);
    expect(r.out).toBe(`full map → ${pathToFileURL(flowFile()).href}\n`);
    expect(r.opened).toEqual([flowFile()]);
  });

  it('color only when stdout is a TTY', async () => {
    expect((await run(['render', specFile(sampleFlow()), '--output', 'cli'])).out).not.toContain('\u001b[');
    expect((await run(['render', specFile(sampleFlow()), '--output', 'cli'], { isTTY: true })).out).toContain('\u001b[');
  });

  it('output resolves through the flow rules named in the spec', async () => {
    config('rules:\n  - name: flows\n    diagram: flow\n    when: x\n    output: web\n');
    const r = await run(['render', specFile({ ...sampleFlow(), rules: ['flows'] })]);
    expect(r.out).toBe(`full map → ${pathToFileURL(flowFile()).href}\n`);
  });

  it('a map rule named in a flow spec (and vice versa) -> exitCode 1, nothing written', async () => {
    config('rules:\n  - name: db\n    paths: ["m/**"]\n');
    const r = await run(['render', specFile({ ...sampleFlow(), rules: ['db'] })]);
    expect(r.code).toBe(1);
    expect(r.err).toBe('codechart: rule in spec is not a flow rule: db\n');
    process.exitCode = undefined;
    const r2 = await run(['render', specFile(spec(2, { rules: ['behaviour-flow'] }))]);
    expect(r2.code).toBe(1);
    expect(r2.err).toBe('codechart: rule in spec is not a map rule: behaviour-flow\n');
    expect(existsSync(out)).toBe(false);
  });

  it('a map and a flow with the same title keep separate HTML files, even when the map title is Flow plus the flow title', async () => {
    await run(['render', specFile(spec(2, { title: 'Flow render flow' })), '--output', 'web'], {
      now: () => new Date(2026, 9, 28, 9, 0, 0),
    });
    await run(['render', specFile(sampleFlow()), '--output', 'web']);
    expect(written()).toEqual(['20261028-090000-flow-render-flow.html', '20261028-090503-render-flow.flow.html']);
  });
});

describe('codechart schema', () => {
  it('schema prints valid JSON containing "nodes"', async () => {
    const r = await run(['schema']);
    expect(JSON.parse(r.out).properties).toHaveProperty('nodes');
  });

  it('schema --flow contains "steps", not "nodes"', async () => {
    const r = await run(['schema', '--flow']);
    const props = JSON.parse(r.out).properties;
    expect(props).toHaveProperty('steps');
    expect(props).not.toHaveProperty('nodes');
  });

  it('schema --config contains "web"', async () => {
    const r = await run(['schema', '--config']);
    const schema = JSON.parse(r.out);
    expect(schema.properties).toHaveProperty('web');
    expect(schema.properties.defaults.properties.output.enum).toContain('auto');
  });
});
