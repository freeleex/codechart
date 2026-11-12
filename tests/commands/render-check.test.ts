import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram, runProgram } from '../../src/program.js';
import { repoFolder } from '../../src/render/output-path.js';
import { gitChanges } from '../../src/rules/selection.js';
import { repoFromTemplate } from '../helpers/sandbox.js';

let tmp: string;
let home: string;
let repo: string;
let out: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString();

function seed(dir: string) {
  mkdirSync(join(dir, 'app'));
  writeFileSync(join(dir, 'app/orders.py'), 'class Order:\n    pass\n');
  writeFileSync(join(dir, 'app/status.py'), 'class Status:\n    pass\n');
  writeFileSync(join(dir, 'app/old.py'), 'class Old:\n    pass\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-render-check-'));
  home = join(tmp, 'home');
  repo = join(tmp, 'repo');
  out = join(tmp, 'out');
  mkdirSync(join(home, '.config', 'codechart'), { recursive: true });
  writeFileSync(join(home, '.config', 'codechart', 'config.yaml'), `web:\n  outDir: ${out}\n`);
  mkdirSync(join(repo, 'app'), { recursive: true });
  repoFromTemplate(repo, seed);
  writeFileSync(join(repo, 'app/orders.py'), 'class Order:\n    coupon = Column(Text)\n');
  process.exitCode = undefined;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.exitCode = undefined;
});

async function run(args: string[]) {
  let stdout = '';
  let stderr = '';
  const program = buildProgram({ cwd: repo, home, env: {}, stdout: (s) => (stdout += s), stderr: (s) => (stderr += s), isTTY: false, open: () => {} });
  await runProgram(program, args, 'user');
  return { out: stdout, err: stderr, code: process.exitCode };
}

function specFile(content: unknown): string {
  const file = join(tmp, 'spec.json');
  writeFileSync(file, JSON.stringify(content));
  return file;
}

const node = (id: string, status: string, path: string, extra: Record<string, unknown> = {}) => ({ id, label: id, kind: 'model', status, layer: 'backend', path, ...extra });

const map = (...nodes: ReturnType<typeof node>[]) => ({ title: 'Orders', kind: 'summary', nodes, edges: [] });

const htmlFile = () => {
  const dir = join(out, repoFolder(repo));
  return readFileSync(join(dir, readdirSync(dir)[0]!), 'utf8');
};

describe('render: map checks', () => {
  it('all match: no alert, the footer counts what was checked', async () => {
    const r = await run(['render', specFile(map(node('Order', 'changed', 'app/orders.py'), node('Status', 'context', 'app/status.py'))), '--git', '--output', 'cli']);
    expect(r.code).toBeUndefined();
    expect(r.out).not.toContain('✗');
    expect(r.out).toContain('2 nodes · 0 new · 1 changed · 0 config · ✓ 2 checked\n');
  });

  it('a mismatch opens the output, inside the --md fence', async () => {
    const r = await run(['render', '--md', specFile(map(node('Order', 'changed', 'app/orders.py'), node('Status', 'changed', 'app/status.py'))), '--git', '--output', 'cli']);
    const lines = r.out.split('\n');
    expect(lines[0]).toMatch(/^\*\*Map\*\*/);
    expect(lines[1]).toBe('```diff');
    expect(lines[2]).toBe("✗ 1 claim doesn't match the code: ~Status not in diff");
    expect(r.out).toContain('· ✓ 1 of 2 checked');
    expect(r.code).toBeUndefined();
  });

  it('--strict exits 1 on a mismatch and 0 without one', async () => {
    const bad = await run(['render', specFile(map(node('Status', 'changed', 'app/status.py'))), '--git', '--strict', '--output', 'cli']);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('✗ 1 claim');
    process.exitCode = undefined;
    const good = await run(['render', specFile(map(node('Order', 'changed', 'app/orders.py'))), '--git', '--strict', '--output', 'cli']);
    expect(good.code).toBeUndefined();
  });

  it('new, removed and changed are compared with git status, not just the file list', async () => {
    writeFileSync(join(repo, 'app/new.py'), 'class New:\n    pass\n');
    const spec = map(node('Modified', 'new', 'app/orders.py'), node('Gone', 'removed', 'app/orders.py'), node('Added', 'changed', 'app/new.py'));
    const r = await run(['render', specFile(spec), '--git', '--output', 'cli']);
    expect(r.out).toContain('+Modified marked new, but modified in git');
    expect(r.out).toContain('-Gone marked removed, but modified in git');
    expect(r.out).toContain('~Added marked changed, but added in git');
    expect(r.code).toBeUndefined();
  });

  it('--git sees a deleted file as removed', async () => {
    rmSync(join(repo, 'app/status.py'));
    const spec = map(node('Status', 'removed', 'app/status.py'), node('Order', 'changed', 'app/orders.py'));
    const r = await run(['render', specFile(spec), '--git', '--output', 'cli']);
    expect(r.out).not.toContain('✗');
    expect(r.out).toContain('✓ 2 checked');
  });

  it('--commit carries added, deleted and renamed statuses', async () => {
    writeFileSync(join(repo, 'app/added.py'), 'class Added:\n    pass\n');
    git('mv', 'app/status.py', 'app/moved.py');
    git('add', '-A');
    git('commit', '-q', '-m', 'move');
    const spec = map(node('Added', 'new', 'app/added.py'), node('Moved', 'changed', 'app/moved.py'), node('Status', 'removed', 'app/status.py'), node('Order', 'changed', 'app/orders.py'));
    const r = await run(['render', specFile(spec), '--commit', 'HEAD', '--output', 'cli']);
    expect(r.out).not.toContain('✗');
    expect(r.out).toContain('✓ 4 checked');
  });

  it('a missing field is a warning that --strict does not fail', async () => {
    const spec = map(node('Order', 'changed', 'app/orders.py', { fields: [{ name: 'discount_code' }], fieldsComplete: false }));
    const r = await run(['render', specFile(spec), '--git', '--strict', '--output', 'cli']);
    expect(r.out).toContain('⚠ 1 warning: ~Order field discount_code not found');
    expect(r.code).toBeUndefined();
  });

  it('says how many nodes have no file to check', async () => {
    const spec = { title: 'Orders', kind: 'summary', nodes: [node('Order', 'changed', 'app/orders.py'), { id: 'Region', label: 'Region', kind: 'config', status: 'config', layer: 'config' }], edges: [] };
    const r = await run(['render', specFile(spec), '--git', '--output', 'cli']);
    expect(r.out).toContain('✓ 1 checked · 1 not checkable');
  });

  it('web output lists warnings under a softer heading', async () => {
    writeFileSync(join(repo, 'app/other.py'), 'class Other:\n    pass\n');
    const spec = {
      ...map(node('Order', 'changed', 'app/orders.py', { fields: [{ name: 'discount_code' }], fieldsComplete: false }), node('Other', 'new', 'app/other.py')),
      edges: [{ from: 'Order', to: 'Other', kind: 'calls' }],
    };
    await run(['render', specFile(spec), '--git', '--output', 'web']);
    const html = htmlFile();
    expect(html).toContain('<span class="ok">✓ 2 nodes checked against the code</span> · <span class="warn">⚠ 2 warnings</span>');
    expect(html).toContain('<h3>Worth checking</h3>');
    expect(html).toContain("doesn&#39;t mention the field discount_code");
    expect(html).toContain("doesn&#39;t mention other, the file app/other.py");
  });

  it('without a diff flag only checks files', async () => {
    const r = await run(['render', specFile(map(node('Status', 'changed', 'app/status.py'), node('Gone', 'context', 'app/gone.py'))), '--output', 'cli']);
    expect(r.out.split('\n')[0]).toBe("✗ 1 claim doesn't match the code: Gone file missing");
  });

  it('a staged rename puts the old path in the diff for a removed node', async () => {
    git('mv', 'app/old.py', 'app/new.py');
    const spec = map(node('Old', 'removed', 'app/old.py'), node('New', 'changed', 'app/new.py'), node('Order', 'changed', 'app/orders.py'));
    const r = await run(['render', specFile(spec), '--git', '--output', 'cli']);
    expect(r.out).not.toContain('✗');
    expect(r.out).toContain('✓ 3 checked');
  });

  it('web output: the alert comes before the link; the HTML has the headline, the flag and the matched line', async () => {
    const spec = map(node('Order', 'changed', 'app/orders.py', { match: 'coupon = Column' }), node('Status', 'changed', 'app/status.py'));
    const r = await run(['render', specFile(spec), '--git', '--output', 'web']);
    expect(r.out).toMatch(/^✗ 1 claim doesn't match the code: ~Status not in diff\nfull map → file:/);
    const html = htmlFile();
    expect(html).toMatch(/<button type="button" class="check bad" aria-controls="page-info"[^>]*><span class="bad">✗ 1 of 2 nodes doesn&#39;t match the code<\/span><\/button>/);
    expect(html).toContain('codechart checked what the agent drew');
    expect(html).toContain('<p class="mismatch-why">The agent says this changed, but git shows no change to its file');
    expect(html).toMatch(/data-id="Status"[^>]*><title>✗ marked changed, but app\/status.py isn&#39;t in the diff\. The agent says/);
    expect(html).toContain('aria-label="Status (changed model, doesn&#39;t match the code)"');
    expect(html).toContain('class="flag"');
    expect(html).toContain('app/<wbr>orders.py:2');
    expect(html).toContain('coupon = Column(Text)');
    expect(html).toContain('marked changed, but app/status.py isn&#39;t in the diff');
  });

  it('web output with a diff flag: the node panel shows the file diff, escaped; without one, no code', async () => {
    writeFileSync(join(repo, 'app/orders.py'), 'class Order:\n    coupon = "<b>"\n');
    const spec = map(node('Order', 'changed', 'app/orders.py'), node('Status', 'context', 'app/status.py'));
    await run(['render', specFile(spec), '--git', '--output', 'web']);
    const html = htmlFile();
    expect(html).toContain('</h3><div class="file"><div class="snippet diff">');
    expect(html).toContain('<span class="d-del dr"><span class="ln">2</span><span class="sg">-</span><span class="cd" style="padding-left:4ch;text-indent:-4ch"><span class="ind">    </span>pass</span></span>');
    expect(html).toContain('<span class="d-add dr"><span class="ln">2</span><span class="sg">+</span><span class="cd" style="padding-left:4ch;text-indent:-4ch"><span class="ind">    </span>coupon = &quot;&lt;b&gt;&quot;</span></span>');
    expect(html).toContain('<h3 class="ch-head">Changes<span class="ch-path">app/<wbr>orders.py</span><span class="fh-stat"><span class="n-add">+1</span> <span class="n-del">−1</span></span></h3>');
    expect(html).not.toContain('whole file');
    expect(html.match(/<h3 class="ch-head">/g)).toHaveLength(1);
    rmSync(out, { recursive: true, force: true });
    await run(['render', specFile(spec), '--output', 'web']);
    expect(htmlFile()).not.toContain('>Changes<');
  });

  it('--md web output keeps the alert in a fence', async () => {
    const spec = map(node('Status', 'changed', 'app/status.py'), node('Order', 'changed', 'app/orders.py'));
    const r = await run(['render', '--md', specFile(spec), '--git', '--output', 'web']);
    expect(r.out).toContain("```diff\n✗ 1 claim doesn't match the code: ~Status not in diff\n```");
  });

  it('--commit checks against that commit; a folder node covers the files under it', async () => {
    const r = await run(['render', specFile(map(node('Status', 'new', 'app/status.py'), node('App', 'context', 'app'))), '--commit', 'HEAD', '--output', 'cli']);
    expect(r.out).not.toContain('✗');
  });

  it('a changed file no node covers is its own ✗ line, and --strict fails on it', async () => {
    const r = await run(['render', specFile(map(node('Status', 'context', 'app/status.py'))), '--git', '--strict', '--output', 'cli']);
    expect(r.out.split('\n')[0]).toBe('✗ 1 changed file not on map: app/orders.py');
    expect(r.out).toContain('· ✓ 1 checked\n');
    expect(r.code).toBe(1);
  });

  it('an omitted entry naming the file explains it', async () => {
    const spec = { ...map(node('Status', 'context', 'app/status.py')), omitted: ['model tweak: orders.py'] };
    const r = await run(['render', specFile(spec), '--git', '--output', 'cli']);
    expect(r.out).not.toContain('✗');
  });

  it('lockfiles, generated files and files a map rule sends to output none are never flagged', async () => {
    writeFileSync(join(repo, '.codechart.yaml'), 'rules:\n  - name: gen\n    paths: ["gen/**"]\n    output: none\n');
    git('add', '.codechart.yaml');
    git('commit', '-q', '-m', 'config', '--', '.codechart.yaml');
    mkdirSync(join(repo, 'gen'));
    mkdirSync(join(repo, 'web/__snapshots__'), { recursive: true });
    writeFileSync(join(repo, 'gen/api.py'), 'x\n');
    writeFileSync(join(repo, 'package-lock.json'), '{}\n');
    writeFileSync(join(repo, 'web/app.min.js'), 'x\n');
    writeFileSync(join(repo, 'web/__snapshots__/a.snap'), 'x\n');
    const r = await run(['render', specFile(map(node('Order', 'changed', 'app/orders.py'))), '--git', '--output', 'cli']);
    expect(r.out).not.toContain('✗');
  });

  it("a moved file's old path is covered by the node at its new path", async () => {
    mkdirSync(join(repo, 'lib'));
    git('mv', 'app/old.py', 'lib/old.py');
    const r = await run(['render', specFile(map(node('Old', 'changed', 'lib/old.py'), node('Order', 'changed', 'app/orders.py'))), '--git', '--output', 'cli']);
    expect(r.out).not.toContain('✗');
  });

  it('web output lists uncovered files in the HTML', async () => {
    const r = await run(['render', specFile(map(node('Status', 'context', 'app/status.py'))), '--git', '--output', 'web']);
    expect(r.out).toMatch(/^✗ 1 changed file not on map: app\/orders.py\nfull map → file:/);
    const html = htmlFile();
    expect(html).toMatch(/<button type="button" class="check bad"[^>]*><span class="ok">✓ 1 node checked against the code<\/span> · <span class="bad">✗ 1 changed file not on map<\/span><\/button>/);
    expect(html).toContain('The map may leave out part of the change.');
    expect(html).toContain('<h3>Changed, not on map</h3>');
    expect(html).toContain('<li>app/orders.py</li>');
  });

  it('an omitted entry that says why is a dashed box on the page, with the changed files it covers', async () => {
    mkdirSync(join(repo, 'frontend/src/pages'), { recursive: true });
    writeFileSync(join(repo, 'frontend/src/pages/Dashboard.tsx'), 'export const Dashboard = () => null;\n');
    const spec = {
      ...map(node('Order', 'changed', 'app/orders.py')),
      omitted: ['frontend pages and components calling telemetry: frontend/src/pages/'],
    };
    const r = await run(['render', specFile(spec), '--git', '--output', 'web']);
    expect(r.out).not.toContain('✗');
    const html = htmlFile();
    expect(html).toContain('<g class="node gap" data-id="omitted-0"');
    expect(html).toContain('frontend pages and components calling telemetry');
    expect(html).toMatch(/<text class="badge"[^>]*>1 changed<\/text>/);
    expect(html).toContain('<h3>Changed files it covers (1)</h3><ul><li>frontend/src/pages/Dashboard.tsx</li></ul>');
  });

  it('plans are never checked for uncovered files', async () => {
    const r = await run(['render', specFile({ ...map(node('Status', 'context', 'app/status.py')), kind: 'plan' }), '--git', '--output', 'cli']);
    expect(r.out).not.toContain('✗');
  });
});

describe('render: --since with --git', () => {
  const baseBranch = () => git('rev-parse', '--abbrev-ref', 'HEAD').trim();

  it('a file added on the branch and edited locally stays new, so a new box passes --strict', async () => {
    const base = baseBranch();
    git('checkout', '-q', '-b', 'feature');
    writeFileSync(join(repo, 'app/new.py'), 'class New:\n    pass\n');
    git('add', 'app/new.py');
    git('commit', '-q', '-m', 'add new');
    writeFileSync(join(repo, 'app/new.py'), 'class New:\n    edited = True\n');
    expect(gitChanges(repo, { since: base, git: true })).toContainEqual({ path: 'app/new.py', status: 'A' });
    const spec = map(node('New', 'new', 'app/new.py'), node('Order', 'changed', 'app/orders.py'));
    const r = await run(['render', specFile(spec), '--since', base, '--git', '--strict', '--output', 'cli']);
    expect(r.out).not.toContain('✗');
    expect(r.out).toContain('✓ 2 checked');
    expect(r.code).toBeUndefined();
  });

  it('a file modified on the branch and deleted locally reads as removed, so a removed box passes --strict', async () => {
    const base = baseBranch();
    git('checkout', '-q', '-b', 'feature');
    writeFileSync(join(repo, 'app/status.py'), 'class Status:\n    edited = True\n');
    git('add', 'app/status.py');
    git('commit', '-q', '-m', 'edit status');
    rmSync(join(repo, 'app/status.py'));
    expect(gitChanges(repo, { since: base, git: true })).toContainEqual({ path: 'app/status.py', status: 'D' });
    const spec = map(node('Status', 'removed', 'app/status.py'), node('Order', 'changed', 'app/orders.py'));
    const r = await run(['render', specFile(spec), '--since', base, '--git', '--strict', '--output', 'cli']);
    expect(r.out).not.toContain('✗');
    expect(r.out).toContain('✓ 2 checked');
    expect(r.code).toBeUndefined();
  });

  it('a file added on the branch and deleted locally cancels out, as the range diff does', async () => {
    const base = baseBranch();
    git('checkout', '-q', '-b', 'feature');
    writeFileSync(join(repo, 'app/temp.py'), 'class Temp:\n    pass\n');
    git('add', 'app/temp.py');
    git('commit', '-q', '-m', 'add temp');
    rmSync(join(repo, 'app/temp.py'));
    expect(gitChanges(repo, { since: base, git: true }).some((c) => c.path === 'app/temp.py')).toBe(false);
    const spec = map(node('Temp', 'removed', 'app/temp.py'), node('Order', 'changed', 'app/orders.py'));
    const r = await run(['render', specFile(spec), '--since', base, '--git', '--output', 'cli']);
    expect(r.out).toContain('✗ 1 claim');
    expect(r.out).toContain('Temp not in diff');
  });
});

describe('render: diff not checked', () => {
  it('a summary in a repo without a diff flag says so in the footer, the stdout above a web link and the HTML', async () => {
    const spec = specFile(map(node('Order', 'changed', 'app/orders.py')));
    expect((await run(['render', spec, '--output', 'cli'])).out).toContain('1 nodes · 0 new · 1 changed · 0 config · ✓ 1 checked · diff not checked\n');
    const web = await run(['render', spec, '--output', 'web']);
    expect(web.out).toMatch(/^diff not checked\nfull map → file:/);
    expect(htmlFile()).toMatch(/<span class="check" title="Rendered without --git[^"]*"><span class="ok">✓ 1 node checked against the code<\/span> · <span class="muted">diff not checked<\/span><\/span>/);
  });

  it('not with a diff flag, for a plan, or outside a repo', async () => {
    const summary = map(node('Order', 'changed', 'app/orders.py'));
    expect((await run(['render', specFile(summary), '--git', '--output', 'cli'])).out).not.toContain('diff not checked');
    expect((await run(['render', specFile({ ...summary, kind: 'plan' }), '--output', 'cli'])).out).not.toContain('diff not checked');
    const outside = join(tmp, 'plain');
    mkdirSync(outside);
    let stdout = '';
    const program = buildProgram({ cwd: outside, home, env: {}, stdout: (s) => (stdout += s), stderr: () => {}, isTTY: false, open: () => {} });
    await runProgram(program, ['render', specFile({ ...summary, nodes: [] }), '--output', 'cli'], 'user');
    expect(stdout).not.toContain('diff not checked');
  });

  it('flows say it too', async () => {
    const flow = { kind: 'summary', title: 'f', start: 'a', steps: [{ id: 'a', label: 'add coupon', status: 'changed', source: 'app/orders.py:2' }], links: [] };
    expect((await run(['render', specFile(flow), '--output', 'cli'])).out).toContain('✓ 1 anchor checked · diff not checked');
  });

  it('selection usage errors exit 2', async () => {
    const head = await run(['render', specFile(map()), '--head', 'main']);
    expect(head.err).toContain('--head needs --since');
    expect(head.code).toBe(2);
    process.exitCode = undefined;
    const both = await run(['render', specFile(map()), '--commit', 'HEAD', '--git']);
    expect(both.err).toContain('--commit does not combine with --git or --since');
    expect(both.code).toBe(2);
  });
});

describe('render: flow checks', () => {
  const flow = (status: string) => ({
    kind: 'summary',
    title: 'Order flow',
    start: 'a',
    steps: [
      { id: 'a', label: 'add coupon', status, source: 'app/orders.py', match: 'coupon = Column' },
      { id: 'b', label: 'load status', status, source: 'app/status.py:1' },
    ],
    links: [{ from: 'a', to: 'b' }],
  });

  it('counts anchors in the footer', async () => {
    const r = await run(['render', specFile(flow('existing')), '--output', 'cli']);
    expect(r.out).toContain('2 steps · 0 new · 0 changed · 0 planned · ✓ 2 anchors checked');
  });

  it("flags a changed step whose file isn't in the diff, and --strict fails on it", async () => {
    const r = await run(['render', specFile(flow('changed')), '--git', '--strict', '--output', 'cli']);
    expect(r.out.split('\n')[0]).toBe("✗ 1 claim doesn't match the code: ~load status not in diff");
    expect(r.out).toContain('✓ 1 of 2 anchors checked');
    expect(r.code).toBe(1);
  });

  it('the flow HTML shows the headline and flags the step', async () => {
    await run(['render', specFile(flow('changed')), '--git', '--output', 'web']);
    const html = htmlFile();
    expect(html).toContain('✗ 1 of 2 anchors doesn&#39;t match the code');
    expect(html).toContain('aria-label="load status (changed end, doesn&#39;t match the code)"');
  });
});
