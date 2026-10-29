import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram, runProgram } from '../../src/program.js';
import { validateSpec } from '../../src/spec/schema.js';

const RAW = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/;
const OSC = '\u001b]8;;https://evil\u0007x\u001b]8;;\u0007\u009b2J‮';

let tmp: string;
let repo: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'codechart-sec-'));
  repo = join(tmp, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(tmp, 'home'));
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
    cwd: repo,
    home: join(tmp, 'home'),
    env: {},
    stdout: (s) => (out += s),
    stderr: (s) => (err += s),
    stdin: async () => stdin,
    isTTY: false,
  });
  await runProgram(program, args, 'user');
  return { out, err, code: process.exitCode };
}

const rules = (name: string) => `rules:\n  - name: ${JSON.stringify(name)}\n    paths: [${JSON.stringify(`src/${name}/**`)}]\n`;

describe('S-5 terminal escapes', () => {
  it('stderr from a bad spec reference is sanitised', async () => {
    const spec = {
      title: 't', kind: 'plan', edges: [{ from: OSC, to: OSC }],
      nodes: [{ id: 'a', label: 'a', kind: 'other', status: 'new', layer: 'l' }],
    };
    const r = await run(['render', '-'], JSON.stringify(spec));
    expect(r.code).toBe(1);
    expect(r.err).toContain('unknown node');
    expect(r.err).not.toMatch(RAW);
  });

  it('stderr from bad JSON on stdin is sanitised', async () => {
    const r = await run(['render', '-'], OSC);
    expect(r.code).toBe(1);
    expect(r.err).toContain('not valid JSON');
    expect(r.err).not.toMatch(RAW);
  });

  it('stderr naming an unreadable spec path is sanitised', async () => {
    const r = await run(['render', `no\u001b]0;pwn\u0007such.json`]);
    expect(r.code).toBe(1);
    expect(r.err).not.toMatch(RAW);
  });

  // rule names and paths can no longer hold control chars (S-1, S-5 config), so the repo dir name carries them
  const hostileRepo = () => {
    repo = join(tmp, 'repo\u001b]0;pwn\u0007\u009b2J\u202e');
    mkdirSync(join(repo, '.git'), { recursive: true });
    writeFileSync(join(repo, '.codechart.yaml'), rules('x'));
  };

  // ESC/BEL are illegal in Windows directory names
  it.skipIf(process.platform === 'win32')('config text output flattens rule sources', async () => {
    hostileRepo();
    const r = await run(['config']);
    expect(r.out).toContain(']0;pwn');
    expect(r.out).not.toMatch(RAW);
  });

  it.skipIf(process.platform === 'win32')('config --json escapes C1 and DEL', async () => {
    hostileRepo();
    const r = await run(['config', '--json']);
    expect(r.out).not.toMatch(/[\u007f-\u009f]/);
    expect(r.out).toContain('\\u009b');
  });

  it('check JSON escapes C1 and DEL', async () => {
    writeFileSync(join(repo, '.codechart.yaml'), rules('x'));
    const r = await run(['check', '--files', 'a\u009bb\u007f.ts']);
    expect(r.out).not.toMatch(/[\u007f-\u009f]/);
  });

  it('flow source with control chars is rejected', () => {
    const flow = {
      diagram: 'flow', kind: 'summary', title: 't', start: 'a',
      steps: [{ id: 'a', label: 'a', type: 'end', status: 'existing', source: 'x\u009by.ts:3' }],
      links: [],
    };
    const r = validateSpec(flow);
    expect(r.ok).toBe(false);
  });
});
