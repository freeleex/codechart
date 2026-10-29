import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { asText, gradeRun, isIncomplete, OUTPUT_RE, RENDER_ERROR_RE, type Grade, type Json } from './bench-grade.js';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const BASE_COMMIT = 'e01760f';
const WRAPPER = 'Answer the user as you normally would, using any skills and tools available to you.';
const MAX_PROCS = 3;
const RUN_TIMEOUT_MS = 15 * 60_000;
const children = new Set<ChildProcess>();

interface Scenario {
  id: string;
  name: string;
  fixture: 'scn-a' | 'scn-trivial';
  prompt: string;
}

const SCENARIOS: Scenario[] = [
  { id: '1-flow', name: 'flow on request', fixture: 'scn-a', prompt: "show me the flow of what `codechart check` does — I can't grasp the edge cases." },
  { id: '2-summary', name: 'change summary', fixture: 'scn-a', prompt: 'summarize the changes in commit 24871a8 for me.' },
  {
    id: '3-plan',
    name: 'plan',
    fixture: 'scn-a',
    prompt: "plan how you'd add a `--dry-run` flag to `codechart render`: it should validate and check anchors, print what it would write, and write nothing. Don't implement it, just the plan.",
  },
  { id: '4-trivial', name: 'trivial change', fixture: 'scn-trivial', prompt: 'summarize my uncommitted changes.' },
];

const ARMS = ['without', 'with'] as const;
type Arm = (typeof ARMS)[number];

interface Args {
  out: string;
  arms: Arm[];
  scenarios: string[];
  runs: number;
  concurrency: number;
  model: string;
  budget: string;
  aggregateOnly: boolean;
  force: boolean;
  warmup: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    out: join(root, '.superpowers', 'sdd', 'bench'),
    arms: [...ARMS],
    scenarios: SCENARIOS.map((s) => s.id),
    runs: 3,
    concurrency: MAX_PROCS,
    model: 'sonnet',
    budget: '2',
    aggregateOnly: false,
    force: false,
    warmup: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    const v = () => argv[++i] ?? '';
    if (k === '--out') a.out = resolve(v());
    else if (k === '--arms') a.arms = v().split(',') as Arm[];
    else if (k === '--scenarios') a.scenarios = v().split(',');
    else if (k === '--runs') a.runs = Number(v());
    else if (k === '--concurrency') a.concurrency = Number(v());
    else if (k === '--model') a.model = v();
    else if (k === '--budget') a.budget = v();
    else if (k === '--aggregate-only') a.aggregateOnly = true;
    else if (k === '--force') a.force = true;
    else if (k === '--no-warmup') a.warmup = false;
    else throw new Error(`unknown flag ${k}`);
  }
  if (!Number.isInteger(a.runs) || a.runs < 1) throw new Error('--runs must be an integer >= 1');
  if (!Number.isInteger(a.concurrency) || a.concurrency < 1) throw new Error('--concurrency must be an integer >= 1');
  a.concurrency = Math.min(MAX_PROCS, a.concurrency);
  for (const arm of a.arms) if (!ARMS.includes(arm)) throw new Error(`unknown arm ${arm}`);
  for (const id of a.scenarios) if (!SCENARIOS.some((x) => x.id === id)) throw new Error(`unknown scenario ${id}`);
  return a;
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });

function makeFixtures(work: string, dirs: Record<string, string>): void {
  for (const f of ['scn-a', 'scn-trivial']) {
    const dir = join(work, f);
    git(root, 'worktree', 'add', '--detach', dir, BASE_COMMIT);
    dirs[f] = dir;
  }
  const file = join(dirs['scn-trivial']!, 'src', 'commands', 'schema.ts');
  const src = readFileSync(file, 'utf8');
  const next = src.replace(/'(print the spec JSON schema[^']*)'/, (_m, body: string) => `"${body.replace('the spec JSON', "the spec's JSON")}"`);
  if (next === src) throw new Error('trivial edit did not apply');
  writeFileSync(file, next);
}

function makeEnvironment(work: string) {
  const plugin = join(work, 'plugin');
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'codechart-bench', version: '0.0.0', description: 'bench' }));
  cpSync(join(root, 'skills', 'codechart'), join(plugin, 'skills', 'codechart'), { recursive: true });

  const cli = join(root, 'dist', 'cli.js');
  if (!existsSync(cli)) throw new Error('dist/cli.js missing: run npm run build');
  const shim = (dir: string, body: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'codechart'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  };
  const withBin = join(work, 'bin-with');
  const withoutBin = join(work, 'bin-without');
  shim(withBin, `exec "${process.execPath}" "${cli}" "$@"`);
  shim(withoutBin, 'echo "codechart: command not found" >&2\nexit 127');

  const env = (arm: Arm) => {
    const e: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (/^(CLAUDECODE|CLAUDE_CODE_(SESSION|MESSAGING|CHILD|EXECPATH|ENTRYPOINT|EXPERIMENTAL)|CLAUDE_PID|CLAUDE_EFFORT|AI_AGENT)/.test(k)) continue;
      e[k] = v;
    }
    const rest = (process.env.PATH ?? '').split(':').filter((p) => !existsSync(join(p, 'codechart')));
    e.PATH = [arm === 'with' ? withBin : withoutBin, ...rest].join(':');
    e.XDG_CONFIG_HOME = join(work, 'xdg');
    return e;
  };
  return { plugin, env };
}

interface Run {
  scenario: string;
  arm: Arm;
  n: number;
}

function runClaude(args: Args, run: Run, cwd: string, plugin: string, env: NodeJS.ProcessEnv, outFile: string): Promise<void> {
  const sc = SCENARIOS.find((s) => s.id === run.scenario)!;
  const cmd = [
    '-p',
    `${sc.prompt}\n\n${WRAPPER}`,
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    args.model,
    '--setting-sources',
    'project',
    '--strict-mcp-config',
    '--permission-mode',
    'dontAsk',
    '--allowedTools',
    'Bash,Read,Grep,Glob,Skill',
    '--disallowedTools',
    'Edit,Write,NotebookEdit',
    '--max-budget-usd',
    args.budget,
    '--no-session-persistence',
    ...(run.arm === 'with' ? ['--plugin-dir', plugin] : []),
  ];
  return new Promise((res, rej) => {
    const started = performance.now();
    const p = spawn('claude', cmd, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(p);
    const timer = setTimeout(() => p.kill('SIGKILL'), RUN_TIMEOUT_MS);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => {
      clearTimeout(timer);
      children.delete(p);
      rej(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      children.delete(p);
      const events: unknown[] = [];
      for (const l of out.split('\n').filter(Boolean)) {
        try {
          events.push(JSON.parse(l));
        } catch {
          events.push({ type: 'unparsed', line: l });
        }
      }
      mkdirSync(join(outFile, '..'), { recursive: true });
      const shown = [...cmd];
      shown[1] = '<prompt>';
      writeFileSync(outFile, JSON.stringify({ run, cmd: ['claude', ...shown], wallMs: performance.now() - started, exitCode: code, stderr: err, events }, null, 1));
      res();
    });
  });
}

async function pool<T>(items: T[], limit: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (let t = queue.shift(); t !== undefined; t = queue.shift()) await fn(t);
    }),
  );
}

interface Metrics {
  input: number;
  cacheRead: number;
  cacheCreate: number;
  output: number;
  total: number;
  turns: number;
  toolCalls: number;
  wallS: number;
  costUsd: number;
  skillInvoked: boolean;
  codechartCalls: string[];
  codechartNotFound: number;
  guideReads: string[];
  skillChars: number;
  guideChars: number;
  checkOutChars: number;
  renderSpecChars: number;
  renderOutChars: number;
  renderCalls: number;
  renderErrors: number;
  otherResultChars: number;
  finalChars: number;
  incomplete: boolean;
  turnInput: Record<string, number>;
  apiCalls: number;
  lineLookups: number;
  checkWithRead: number;
  checkCalls: number;
  grade: Grade;
}

function metricsOf(file: string): Metrics {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Json;
  const events = raw.events as Json[];
  const result = events.find((e) => e.type === 'result') ?? {};
  const u = result.usage ?? {};
  const m: Metrics = {
    input: u.input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheCreate: u.cache_creation_input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    total: 0,
    turns: result.num_turns ?? 0,
    toolCalls: 0,
    wallS: (raw.wallMs ?? 0) / 1000,
    costUsd: result.total_cost_usd ?? 0,
    skillInvoked: false,
    codechartCalls: [],
    codechartNotFound: 0,
    guideReads: [],
    skillChars: 0,
    guideChars: 0,
    checkOutChars: 0,
    renderSpecChars: 0,
    renderOutChars: 0,
    renderCalls: 0,
    renderErrors: 0,
    otherResultChars: 0,
    finalChars: (result.result ?? '').length,
    incomplete: isIncomplete(raw),
    turnInput: {},
    apiCalls: new Set(events.filter((e) => e.type === 'assistant').map((e) => e.message?.id)).size,
    lineLookups: 0,
    checkWithRead: 0,
    checkCalls: 0,
    grade: gradeRun(events, raw.run?.scenario ?? ''),
  };
  m.total = m.input + m.cacheRead + m.cacheCreate + m.output;

  const calls = new Map<string, string>();
  for (const e of events) {
    if (e.type === 'assistant') {
      for (const b of (e.message?.content ?? []) as Json[]) {
        if (b.type !== 'tool_use') continue;
        m.toolCalls++;
        let kind = 'other';
        if (b.name === 'Skill') {
          kind = 'skill';
          m.skillInvoked = true;
        } else if (b.name === 'Read' && /(flow-guide|spec-guide|example)\.md$/.test(b.input?.file_path ?? '')) {
          kind = 'guide';
          m.guideReads.push(String(b.input.file_path).split('/').pop()!);
        } else if (b.name === 'Bash') {
          const c: string = b.input?.command ?? '';
          const sub = c.match(/\bcodechart\s+(check|render|schema|install-skill)/)?.[1];
          if (sub) m.codechartCalls.push(sub);
          if (/\b(sed -n|cat -n|grep -n|nl )/.test(c)) m.lineLookups++;
          if (sub === 'check') {
            kind = 'check';
            m.checkCalls++;
            if (/\bgit (diff|show)\b/.test(c.replace(/\$\([^)]*\)/g, ''))) m.checkWithRead++;
          }
          else if (sub === 'render') {
            kind = 'render';
            m.renderCalls++;
            m.renderSpecChars += c.length;
          } else if (sub === 'schema') kind = 'schema';
        }
        calls.set(b.id, kind);
      }
    } else if (e.type === 'user') {
      const content = e.message?.content;
      if (!Array.isArray(content)) continue;
      for (const b of content as Json[]) {
        if (b.type !== 'tool_result') continue;
        const text = asText(b.content);
        const kind = calls.get(b.tool_use_id) ?? 'other';
        if (/codechart: command not found/.test(text)) m.codechartNotFound++;
        if (kind === 'skill') m.skillChars += text.length;
        else if (kind === 'guide') m.guideChars += text.length;
        else if (kind === 'check') m.checkOutChars += text.length;
        else if (kind === 'render') {
          m.renderOutChars += text.length;
          if (b.is_error || RENDER_ERROR_RE.test(text.replace(OUTPUT_RE, ''))) m.renderErrors++;
        } else m.otherResultChars += text.length;
      }
    }
  }
  m.turnInput = attributeTurns(events, calls);
  return m;
}

// Input-side tokens of each model turn, charged to the tool kinds whose results that turn reads.
function attributeTurns(events: Json[], calls: Map<string, string>): Record<string, number> {
  const turns = new Map<string, { tokens: number; kinds: string[] }>();
  for (const e of events) {
    if (e.type !== 'assistant') continue;
    const id = e.message?.id as string;
    const u = e.message?.usage ?? {};
    const t = turns.get(id) ?? { tokens: 0, kinds: [] };
    t.tokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    for (const b of (e.message?.content ?? []) as Json[]) if (b.type === 'tool_use') t.kinds.push(calls.get(b.id) ?? 'other');
    turns.set(id, t);
  }
  const out: Record<string, number> = {};
  let prev = ['initial'];
  for (const t of turns.values()) {
    for (const k of prev) out[k] = (out[k] ?? 0) + t.tokens / prev.length;
    prev = t.kinds.length ? t.kinds : ['other'];
  }
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const range = (xs: number[]) => `${Math.min(...xs)}–${Math.max(...xs)}`;

function runFiles(args: Args, arm: Arm, id: string): string[] {
  const dir = join(args.out, arm);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(`${id}-`) && f.endsWith('.json'))
    .sort()
    .map((f) => join(dir, f));
}

// Failed or timed-out runs read as zero usage, so they stay in the details table only.
const completeRuns = (args: Args, arm: Arm, id: string): Metrics[] => runFiles(args, arm, id).map(metricsOf).filter((m) => !m.incomplete);
const runCount = (args: Args, arm: Arm, id: string, ms: Metrics[]) => `${ms.length}/${runFiles(args, arm, id).length}`;

function aggregate(args: Args): string {
  const scs = SCENARIOS.filter((s) => args.scenarios.includes(s.id));
  const lines: string[] = [
    '| scenario | arm | n (complete/all) | total tok (median, min–max) | input | cache read | cache create | output | tool calls | turns | wall s | cost $ |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  const med: Record<string, Partial<Record<Arm, number>>> = {};
  for (const sc of scs) {
    for (const arm of args.arms) {
      const ms = completeRuns(args, arm, sc.id);
      if (!ms.length) continue;
      const col = (k: keyof Metrics) => ms.map((m) => m[k] as number);
      (med[sc.id] ??= {})[arm] = median(col('total'));
      lines.push(
        `| ${sc.id} | ${arm} | ${runCount(args, arm, sc.id, ms)} | ${median(col('total'))} (${range(col('total'))}) | ${median(col('input'))} | ${median(col('cacheRead'))} | ${median(col('cacheCreate'))} | ${median(col('output'))} | ${median(col('toolCalls'))} | ${median(col('turns'))} | ${median(col('wallS')).toFixed(1)} | ${median(col('costUsd')).toFixed(3)} |`,
      );
    }
  }
  lines.push('', '| scenario | arm | input-side tokens by what the turn follows (median) |', '|---|---|---|');
  for (const sc of scs) {
    for (const arm of args.arms) {
      const ms = completeRuns(args, arm, sc.id);
      if (!ms.length) continue;
      const kinds = [...new Set(ms.flatMap((m) => Object.keys(m.turnInput)))];
      lines.push(`| ${sc.id} | ${arm} | ${kinds.map((k) => `${k} ${Math.round(median(ms.map((m) => m.turnInput[k] ?? 0)))}`).join(', ')} |`);
    }
  }
  lines.push('', '| scenario | with vs without (median total) |', '|---|---|');
  for (const [id, t] of Object.entries(med)) {
    if (t.with !== undefined && t.without) lines.push(`| ${id} | ${(((t.with - t.without) / t.without) * 100).toFixed(0)}% |`);
  }
  lines.push(
    '',
    '| scenario | arm | n (complete/all) | diagram shown | paste verbatim | no stray **Map**/**Flow** line | no unrendered diagram | trivial skip | first render ok | check + git diff/show in one call | API calls (median) | line lookups (median) |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const sc of scs) {
    for (const arm of args.arms) {
      const ms = completeRuns(args, arm, sc.id);
      if (!ms.length) continue;
      const count = (pred: (m: Metrics) => boolean | null, of: (m: Metrics) => boolean = () => true) => {
        const rel = ms.filter(of);
        return rel.length ? `${rel.filter((m) => pred(m)).length}/${rel.length}` : '-';
      };
      const rendered = (m: Metrics) => m.grade.outputs > 0;
      lines.push(
        `| ${sc.id} | ${arm} | ${runCount(args, arm, sc.id, ms)} | ${count((m) => m.grade.shown, (m) => m.skillInvoked && m.grade.shown !== null)} | ${count((m) => m.grade.pasted === m.grade.outputs, rendered)} | ${count((m) => m.grade.extraHeaders === 0, rendered)} | ${count((m) => m.grade.unrendered === 0)} | ${count((m) => m.grade.trivialSkip, (m) => m.grade.trivialSkip !== null)} | ${count((m) => m.grade.firstRenderOk, (m) => m.grade.firstRenderOk !== null)} | ${count((m) => m.checkWithRead > 0, (m) => m.checkCalls > 0)} | ${median(ms.map((m) => m.apiCalls))} | ${median(ms.map((m) => m.lineLookups))} |`,
      );
    }
  }
  lines.push(
    '',
    '| scenario | arm | run | skill | codechart calls | not-found | guides | skill chars | guide chars | check out | render spec | render out | render calls | render errs | other results | final chars | pasted | extra hdr | unrendered | api calls | error |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const sc of scs) {
    for (const arm of args.arms) {
      for (const f of runFiles(args, arm, sc.id)) {
        const m = metricsOf(f);
        lines.push(
          `| ${sc.id} | ${arm} | ${f.replace(/^.*-(\d+)\.json$/, '$1')} | ${m.skillInvoked} | ${m.codechartCalls.join('+') || '-'} | ${m.codechartNotFound} | ${m.guideReads.join('+') || '-'} | ${m.skillChars} | ${m.guideChars} | ${m.checkOutChars} | ${m.renderSpecChars} | ${m.renderOutChars} | ${m.renderCalls} | ${m.renderErrors} | ${m.otherResultChars} | ${m.finalChars} | ${m.grade.pasted}/${m.grade.outputs} | ${m.grade.extraHeaders} | ${m.grade.unrendered} | ${m.apiCalls} | ${m.incomplete} |`,
        );
      }
    }
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.aggregateOnly) {
    const dirs = [join(args.out, 'with'), join(args.out, 'without')];
    if (!args.force && dirs.some((d) => existsSync(d) && readdirSync(d).length)) {
      throw new Error(`${args.out} already holds results; pass --force to overwrite or use another --out`);
    }
    const work = mkdtempSync(join(tmpdir(), 'codechart-bench-'));
    const fixtures: Record<string, string> = {};
    const cleanup = () => {
      for (const c of children) c.kill('SIGKILL');
      for (const d of Object.values(fixtures)) {
        try {
          git(root, 'worktree', 'remove', '--force', d);
        } catch (e) {
          console.error(`could not remove worktree ${d}: ${String(e)}`);
        }
      }
      rmSync(work, { recursive: true, force: true });
    };
    for (const sig of ['SIGINT', 'SIGTERM'] as const) {
      process.on(sig, () => {
        cleanup();
        process.exit(130);
      });
    }
    try {
      makeFixtures(work, fixtures);
      const { plugin, env } = makeEnvironment(work);
      const runs: Run[] = [];
      for (let n = 1; n <= args.runs; n++) for (const scenario of args.scenarios) for (const arm of args.arms) runs.push({ scenario, arm, n });
      if (args.force) for (const r of runs) rmSync(join(args.out, r.arm, `${r.scenario}-${r.n}.json`), { force: true });
      console.error(`fixtures: ${work}`);
      const exec = (file: (r: Run) => string) => async (r: Run) => {
        const sc = SCENARIOS.find((s) => s.id === r.scenario)!;
        await runClaude(args, r, fixtures[sc.fixture]!, plugin, env(r.arm), file(r));
        console.error(`done ${r.arm} ${r.scenario} #${r.n}`);
      };
      // Run 1 of a cell otherwise pays the prompt-cache write the later runs read (9.5 r2: +$0.016), skewing N=3 medians.
      if (args.warmup) {
        const warm = runs.filter((r) => r.n === 1).map((r) => ({ ...r, n: 0 }));
        await pool(warm, args.concurrency, exec((r) => join(args.out, r.arm, 'warmup', `${r.scenario}.json`)));
      }
      await pool(runs, args.concurrency, exec((r) => join(args.out, r.arm, `${r.scenario}-${r.n}.json`)));
    } finally {
      cleanup();
    }
  }
  console.log(aggregate(args));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
