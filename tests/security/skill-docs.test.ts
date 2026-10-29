import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateSpec } from '../../src/spec/schema.js';

const read = (file: string) => readFileSync(`skills/codechart/${file}`, 'utf8');
// Whole specs have a title; title-less blocks are fragments.
const jsonBlocks = (text: string) =>
  [...text.matchAll(/```json\n([\s\S]*?)```/g)]
    .map((m) => m[1]!)
    .filter((b) => b.includes('"title"'))
    .map((b) => JSON.parse(b) as Record<string, unknown>);

describe('S-18 skill renders via stdin', () => {
  it.each(['SKILL.md', 'example.md'])('%s writes no temp spec file', (file) => {
    const text = read(file);
    expect(text).not.toMatch(/TMPDIR|\/tmp\b/);
    expect(text).toContain("codechart render --md - <<'EOF'");
  });
});

describe('SKILL.md spec skeletons', () => {
  const [flow, map] = jsonBlocks(read('SKILL.md'));

  it('has a flow and a map skeleton that pass validation', () => {
    expect(flow).toHaveProperty('steps');
    expect(map).toHaveProperty('nodes');
    for (const spec of [flow, map]) {
      const r = validateSpec(spec);
      expect(r.ok ? [] : r.errors).toEqual([]);
    }
  });

  it('flow skeleton anchors every branch leaving a decision with match, and steps with match or a range', () => {
    const steps = flow!.steps as { id: string; source?: string; match?: string }[];
    const links = flow!.links as { from: string; source?: string; match?: string }[];
    for (const st of steps) expect(st.match !== undefined || /:\d+-\d+$/.test(st.source ?? ''), st.id).toBe(true);
    const out = new Map<string, number>();
    for (const l of links) out.set(l.from, (out.get(l.from) ?? 0) + 1);
    const branches = links.filter((l) => (out.get(l.from) ?? 0) >= 2);
    expect(branches.length).toBeGreaterThan(0);
    for (const b of branches) expect(b.match, JSON.stringify(b)).toBeTruthy();
  });

  it('says a match must be on exactly one line', () => {
    expect(read('SKILL.md')).toContain('it must be on exactly one line of the file');
  });
});

describe('guide and example specs pass validation', () => {
  it.each(['example.md', 'flow-guide.md'])('%s', (file) => {
    const specs = jsonBlocks(read(file));
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      const r = validateSpec(spec);
      expect(r.ok ? [] : r.errors).toEqual([]);
    }
  });
});
