import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { builtinRules } from '../../src/config/builtin-rules.js';
import { buildProgram } from '../../src/program.js';
import { STEP_STATUSES } from '../../src/spec/flow.js';
import { EDGE_KINDS, NODE_KINDS, STATUSES } from '../../src/spec/schema.js';

const dir = join(import.meta.dirname, '..', '..', 'skills', 'codechart');
const docs = ['SKILL.md', 'example.md'].map((f) => ({ f, text: readFileSync(join(dir, f), 'utf8') }));
const skill = docs[0]!.text;

// Inline code spans and fenced lines that run codechart.
function commandLines(text: string): string[] {
  const spans = [...text.matchAll(/`([^`\n]*codechart (?:check|render)[^`\n]*)`/g)].map((m) => m[1]!);
  const fenced = text
    .split('\n')
    .filter((l) => /\bcodechart (check|render)/.test(l) && /^(\$ |codechart )/.test(l))
    .map((l) => l.slice(l.indexOf('codechart ')));
  return [...spans, ...fenced];
}

const optionsOf = (name: string) =>
  buildProgram()
    .commands.find((c) => c.name() === name)!
    .options.map((o) => o.long!);

describe('skill command examples (S-1)', () => {
  it.each(docs)('$f: every <placeholder> in a command is single-quoted', ({ text }) => {
    const lines = commandLines(text);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.replace(/'[^']*'/g, ''), line).not.toMatch(/<[^>]+>/);
  });

  it.each(docs)('$f: commands build no shell substitution and single-quote every flag value', ({ text }) => {
    const lines = commandLines(text);
    const valued = /--(?:files|commit|since|head|matched)\s+(\S)/g;
    expect(lines.some((l) => /--(?:files|commit|since)\s/.test(l))).toBe(true);
    for (const line of lines) {
      expect(line, line).not.toMatch(/\$\(|`/);
      for (const [, first] of line.matchAll(valued)) expect(first, line).toBe("'");
    }
  });

  it.each(docs)('$f: every flag in a command exists on that command', ({ text }) => {
    const known = { check: optionsOf('check'), render: optionsOf('render') };
    for (const line of commandLines(text)) {
      const sub = line.match(/codechart (check|render)/)![1] as 'check' | 'render';
      for (const [flag] of line.matchAll(/--[a-z-]+/g)) expect(known[sub], line).toContain(flag);
    }
    const bare = [...text.matchAll(/`(--[a-z-]+)[ `]/g)].map((m) => m[1]!);
    for (const flag of bare) expect([...known.check, ...known.render], flag).toContain(flag);
  });

  it('SKILL.md states the allowlist and the leading-dash ban', () => {
    expect(skill).toContain('Single-quote every value');
    expect(skill).toContain("Only paste values made of letters, digits, spaces and `. _ / @ : + = , - [ ] ( ) ~ ^` that don't start with `-`");
  });
});

describe('codechart --version', () => {
  it('matches package.json, so a release bump updates both', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')) as { version: string };
    expect(buildProgram().version()).toBe(pkg.version);
  });
});

describe('SKILL.md frontmatter (Agent Skills spec)', () => {
  // Strict parsers (OpenCode and others) drop a skill whose frontmatter isn't valid YAML.
  it('is strict YAML with a name matching the folder and a description of at most 1024 chars', () => {
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(skill);
    expect(fm).not.toBeNull();
    const meta = parse(fm![1]!, { strict: true, uniqueKeys: true }) as Record<string, unknown>;
    expect(meta.name).toBe('codechart');
    expect(typeof meta.description).toBe('string');
    expect((meta.description as string).length).toBeGreaterThan(0);
    expect((meta.description as string).length).toBeLessThanOrEqual(1024);
  });
});

describe('SKILL.md stays in sync with the CLI', () => {
  // check leaves toJudge out when it equals the built-ins, trusting the skill to list them word for word.
  it('lists every built-in plain-language rule with its exact when text', () => {
    const plain = builtinRules('auto').filter((r) => r.when);
    expect(plain.map((r) => r.name)).toEqual(['related-files', 'behaviour-flow']);
    for (const r of plain) expect(skill, r.name).toMatch(new RegExp(`\`${r.name}\` \\([^)]*\\): ${r.when!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
  });

  it('names the render notice for output none and the check fields it relies on', () => {
    expect(skill).toContain('`no map drawn`/`no flow drawn`');
    for (const field of ['pathMatches', 'judgeBuiltins', 'toJudge', 'remainingFiles', 'final']) expect(skill, field).toContain(`\`${field}\``);
    expect(skill).not.toContain('--matched');
  });

  it('lists every node kind, edge kind and status the schema accepts', () => {
    const listed = (values: readonly string[]) => values.map((v) => `\`${v}\``);
    expect(skill).toContain(listed(NODE_KINDS).join(' ').replace('`file`', '`file` (default with `path`)'));
    expect(skill).toContain(listed(EDGE_KINDS).join(' '));
    for (const v of [...STATUSES, ...STEP_STATUSES]) expect(skill, v).toContain(`\`${v}\``);
  });

  it('keeps the paste rule: every diagram is one render output, header and key untouched', () => {
    expect(skill).toContain('Every diagram in the reply is the exact text of one successful render: never typed, redrawn or edited by hand.');
    expect(skill).toContain('header on one line');
    expect(skill).toContain('the key too');
  });
});
