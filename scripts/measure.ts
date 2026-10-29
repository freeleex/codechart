import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const shell = process.platform === 'win32';
const RUNS = 10;
const START = '<!-- measure:start -->';
const END = '<!-- measure:end -->';
const DOC = join(root, 'docs', 'efficiency.md');
const FIXTURES = join(root, 'tests', 'fixtures', 'measure');

const SPECS = [
  { name: 'small map', file: 'small.map.json' },
  { name: 'large map (120 nodes)', file: 'large.map.json' },
  { name: 'flow', file: 'flow.flow.json' },
];

const kB = (n: number) => `${(n / 1000).toFixed(1)} kB`;
const MB = (n: number) => `${(n / 1e6).toFixed(2)} MB`;
const ms = (n: number) => `${n.toFixed(0)} ms`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

function dirSize(dir: string): number {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : e.isFile() ? statSync(p).size : 0;
  }
  return total;
}

function sh(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): string {
  return execFileSync(cmd, args, { cwd, env, encoding: 'utf8', shell, stdio: ['ignore', 'pipe', 'pipe'] });
}

function coldStart(bin: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): number {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    const r = spawnSync(process.execPath, [bin, ...args], { cwd, env, stdio: 'ignore' });
    times.push(performance.now() - t);
    if (r.status !== 0) throw new Error(`codechart ${args.join(' ')} exited ${r.status}`);
  }
  return median(times)!;
}

function htmlBytes(home: string): number {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) files.push(p);
    }
  };
  walk(home);
  if (files.length === 0) throw new Error(`no html written under ${home}`);
  return statSync(files[files.length - 1]!).size;
}

function measure(): { version: string; body: string } {
  const tmp = mkdtempSync(join(tmpdir(), 'codechart-measure-'));
  try {
    const packDir = join(tmp, 'pack');
    const project = join(tmp, 'project');
    mkdirSync(packDir);
    mkdirSync(project);

    sh(npm, ['run', 'build'], root);
    const packOut = sh(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', packDir], root);
    const pack = JSON.parse(packOut)[0] as { filename: string; size: number; unpackedSize: number; entryCount: number };
    writeFileSync(join(project, 'package.json'), '{"name":"measure-project","version":"0.0.0","private":true}\n');
    writeFileSync(join(project, 'anchors.txt'), 'line\n'.repeat(10));
    sh(npm, ['i', '--prefer-offline', '--no-audit', '--no-fund', '--ignore-scripts', join(packDir, pack.filename)], project);

    const modules = join(project, 'node_modules');
    const pkg = JSON.parse(readFileSync(join(modules, 'codechart', 'package.json'), 'utf8')) as { version: string; dependencies: Record<string, string> };
    const sizes = new Map<string, number>();
    for (const e of readdirSync(modules, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === '.bin' || e.name === 'codechart') continue;
      sizes.set(e.name, dirSize(join(modules, e.name)));
    }
    const runtime = [...sizes.values()].reduce((a, b) => a + b, 0);
    const skillBytes = readdirSync(join(root, 'skills', 'codechart'))
      .filter((f) => f.endsWith('.md'))
      .reduce((n, f) => n + statSync(join(root, 'skills', 'codechart', f)).size, 0);

    const bin = join(modules, 'codechart', 'dist', 'cli.js');
    const home = join(tmp, 'home');
    mkdirSync(home);
    const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, '.config'), NO_COLOR: '1' };
    const starts: [string, number][] = [
      ['`--version`', coldStart(bin, ['--version'], project, env)],
      ['`check --files`', coldStart(bin, ['check', '--files', 'package.json'], project, env)],
    ];
    const html: [string, number][] = [];
    for (const s of SPECS) {
      const spec = join(FIXTURES, s.file);
      starts.push([`\`render --output web\` ${s.name}`, coldStart(bin, ['render', spec, '--output', 'web'], project, env)]);
      html.push([s.name, htmlBytes(home)]);
      rmSync(join(home, '.cache'), { recursive: true, force: true });
    }

    const deps = Object.keys(pkg.dependencies).sort();
    const body = [
      `Size (\`npm pack\` + \`npm i\` of the tarball)`,
      '',
      '| Metric | Value |',
      '|---|---|',
      `| Tarball packed | ${kB(pack.size)} |`,
      `| Tarball unpacked | ${kB(pack.unpackedSize)} |`,
      `| Tarball files | ${pack.entryCount} |`,
      `| Installed node_modules (runtime, excl. codechart) | ${MB(runtime)} |`,
      ...deps.map((d) => `| - ${d} | ${kB(sizes.get(d) ?? 0)} |`),
      `| Skill text (skills/codechart/*.md) | ${kB(skillBytes)} |`,
      '',
      `Cold start (median of ${RUNS}, \`node dist/cli.js\`)`,
      '',
      '| Command | Time |',
      '|---|---|',
      ...starts.map(([n, t]) => `| ${n} | ${ms(t)} |`),
      '',
      'HTML output size',
      '',
      '| Spec | Size |',
      '|---|---|',
      ...html.map(([n, b]) => `| ${n} | ${kB(b)} |`),
      '',
    ].join('\n');
    return { version: pkg.version, body };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main(): void {
  const write = process.argv.includes('--write');
  const { version, body } = measure();
  const date = new Date().toISOString().slice(0, 10);
  const cmd = `npx tsx scripts/measure.ts${write ? ' --write' : ''}`;
  const block = [
    START,
    `Measured ${date} | codechart ${version} | node ${process.version} | ${process.platform} ${process.arch} | \`${cmd}\``,
    '',
    body,
    END,
  ].join('\n');
  if (!write) {
    console.log(block);
    return;
  }
  const doc = readFileSync(DOC, 'utf8');
  const a = doc.indexOf(START);
  const b = doc.indexOf(END);
  if (a < 0 || b < a) throw new Error(`${DOC}: missing ${START} ... ${END}`);
  writeFileSync(DOC, doc.slice(0, a) + block + doc.slice(b + END.length));
  console.log(`updated ${DOC}`);
}

main();
