import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { EXPLAIN_FILES } from '../fixtures/explain.js';
import { git, makeSandbox, removeSandbox, repoFromTemplate, runCli, type Sandbox } from './sandbox.js';

function seed(dir: string) {
  for (const [file, text] of Object.entries(EXPLAIN_FILES)) {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
}

/** A repo seeded with the explain fixture's files, set up and torn down around each test of the calling file. */
export function useExplainSandbox(prefix: string) {
  const sb = {} as Sandbox;
  let tick = 0;
  beforeEach(() => {
    Object.assign(sb, makeSandbox(prefix, { htmlOut: true }));
    repoFromTemplate(sb.repo, seed);
  });
  afterEach(() => removeSandbox(sb.tmp));

  const run = (spec: unknown, ...args: string[]) => {
    process.exitCode = undefined;
    const now = new Date(2026, 10, 10, 10, 0, tick++);
    writeFileSync(join(sb.tmp, 'explain.json'), JSON.stringify(spec));
    return runCli({ cwd: sb.repo, home: sb.home, now: () => now, isTTY: false }, ['render', join(sb.tmp, 'explain.json'), ...args]);
  };
  const outDir = (): string => join(sb.out, readdirSync(sb.out)[0]!);
  const outFiles = (): string[] => (existsSync(sb.out) ? readdirSync(outDir()) : []);
  const html = (): string => readFileSync(join(outDir(), outFiles().find((n) => n.endsWith('.html'))!), 'utf8');
  return { sb, run, outDir, outFiles, html };
}
