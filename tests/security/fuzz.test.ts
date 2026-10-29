import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseConfigFile } from '../../src/config/schema.js';
import { markdownBlock } from '../../src/render/markdown.js';
import { FLOW_KEY, flowMarkdown } from '../../src/render/flow/tree.js';
import { sanitizeText } from '../../src/render/strip.js';
import { flat } from '../../src/render/terminal/wrap.js';
import { renderTerminal } from '../../src/render/terminal/render.js';
import { esc, renderHtml } from '../../src/render/web/html.js';
import { layoutSpec } from '../../src/render/web/layout.js';
import { validateSpec, type Spec } from '../../src/spec/schema.js';

const RUNS = { numRuns: 150, interruptAfterTimeLimit: 20_000, markInterruptAsFailure: true };
const NASTY = [
  '</script>', '<script>alert(1)</script>', '"><img src=x onerror=1>', '```', '````text', '\u001b[2J', '\u001b]8;;http://x\u0007',
  '\u009b2J', '‮', ' ', '\u0000', '\n', '\r\n', '&amp;', "'", '<!--', '-->', '$(x)', '[a](javascript:1)',
];
const text = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 300 }),
  fc.array(fc.oneof(fc.constantFrom(...NASTY), fc.string({ maxLength: 10 })), { maxLength: 30 }).map((a) => a.join('')),
  fc.nat({ max: 20_000 }).chain((n) => fc.constantFrom('x', '`', '<', '\u001b').map((c) => c.repeat(n))),
);
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;
const BIDI = /[​‌‎‏‪-‮⁠-⁩﻿]/;

describe('escapers (property)', () => {
  it('esc leaves no raw HTML metacharacters or invisibles', () => {
    fc.assert(
      fc.property(text, (s) => {
        const out = esc(s);
        expect(out).not.toMatch(/[<>"']/);
        expect(out).not.toMatch(BIDI);
        expect(out.replace(/&(amp|lt|gt|quot|#39);/g, '')).not.toContain('&');
      }),
      RUNS,
    );
  });

  it('flat has no control or invisible chars', () => {
    fc.assert(fc.property(text, (s) => {
      const out = flat(s);
      expect(out).not.toMatch(CONTROL);
      expect(out).not.toMatch(BIDI);
    }), RUNS);
  });

  it('sanitizeText keeps only \\n and \\t as controls', () => {
    fc.assert(fc.property(text, (s) => {
      const out = sanitizeText(s);
      expect(out.replace(/[\n\t]/g, '')).not.toMatch(CONTROL);
      expect(out).not.toMatch(BIDI);
    }), RUNS);
  });

  it('flow --md title stays inside the fence, header constant', () => {
    fc.assert(fc.property(text, text, (title, tree) => {
      const out = flowMarkdown(title, `${tree}\n\`\`\`\``, undefined, 80);
      const [header, fence] = out.split('\n');
      expect(header).toBe(`**Flow** _(${FLOW_KEY})_`);
      expect(out.endsWith(`\n${fence!.replace('text', '')}\n`)).toBe(true);
      expect(out.split('\n').filter((l) => l.startsWith(fence!.replace('text', ''))).length).toBe(2);
    }), RUNS);
  });

  it('markdown fence cannot be closed from inside the body', () => {
    fc.assert(fc.property(text, (body) => {
      const out = markdownBlock('h', body, undefined);
      const [, fence] = /^h\n(`+)text\n/.exec(out) ?? [];
      expect(fence).toBeDefined();
      const inner = out.slice(`h\n${fence}text\n`.length, out.length - `\n${fence}\n`.length);
      const longest = Math.max(0, ...(inner.match(/`+/g) ?? []).map((r) => r.length));
      expect(fence!.length).toBeGreaterThan(longest);
      expect(fence!.length).toBeGreaterThanOrEqual(3);
    }), RUNS);
  });
});

const node = (id: string, label: string) => ({ id, label: label || 'x', kind: 'other', status: 'new', layer: 'l' });

describe('renderers on hostile labels (property)', () => {
  it('terminal output has no control chars; html keeps the same script tags', async () => {
    const b = validateSpec({ title: 't', kind: 'plan', nodes: [node('n0', 'plain')], edges: [] });
    if (!b.ok) throw new Error('baseline invalid');
    const bh = renderHtml(b.spec as Spec, await layoutSpec(b.spec as Spec), { generatedAt: new Date(0), repo: 'r' });
    const baseline = { opens: bh.match(/<script/gi)?.length, closes: bh.match(/<\/script>/gi)?.length };
    await fc.assert(
      fc.asyncProperty(fc.array(text, { minLength: 1, maxLength: 4 }), async (labels) => {
        const nodes = labels.map((l, i) => node(`n${i}`, l.slice(0, 200)));
        const r = validateSpec({ title: 't', kind: 'plan', nodes, edges: [] });
        if (!r.ok) return;
        const spec = r.spec as Spec;
        const term = renderTerminal(spec, { maxNodes: 20, width: 80, color: false });
        expect(term.replace(/\n/g, '')).not.toMatch(CONTROL);
        const html = renderHtml(spec, await layoutSpec(spec), { generatedAt: new Date(0), repo: 'r' });
        expect(html.match(/<script/gi)?.length).toBe(baseline.opens);
        expect(html.match(/<\/script>/gi)?.length).toBe(baseline.closes);
      }),
      { numRuns: 40, interruptAfterTimeLimit: 20_000, markInterruptAsFailure: true },
    );
  }, 30_000);
});

describe('validators (property)', () => {
  const json: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
    v: fc.oneof(
      { depthSize: 'small' },
      fc.constant(null), fc.boolean(), fc.integer(), fc.double(), text,
      fc.array(tie('v'), { maxLength: 5 }),
      fc.dictionary(fc.constantFrom('title', 'kind', 'nodes', 'edges', 'diagram', 'steps', 'links', 'gaps', 'output', 'rules', 'web', 'id', 'label', 'status', '__proto__', 'constructor'), tie('v'), { maxKeys: 6 }),
    ),
  })).v;

  it('validateSpec never throws on arbitrary input', () => {
    fc.assert(fc.property(json, (v) => {
      const r = validateSpec(v);
      expect(typeof r.ok).toBe('boolean');
      if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
    }), RUNS);
  });

  it('validateSpec with diagram:flow never throws', () => {
    fc.assert(fc.property(json, (v) => {
      const input = typeof v === 'object' && v !== null && !Array.isArray(v) ? { ...v, diagram: 'flow' } : { diagram: 'flow' };
      expect(typeof validateSpec(input).ok).toBe('boolean');
    }), RUNS);
  });

  it('validateSpec on near-valid specs with hostile strings never throws', () => {
    fc.assert(fc.property(text, text, (label, title) => {
      const r = validateSpec({ title, kind: 'plan', nodes: [node('a', label), node('b', 'b')], edges: [{ from: 'a', to: 'b', label }] });
      expect(typeof r.ok).toBe('boolean');
    }), RUNS);
  });

  it('flow specs with hostile labels and match, no types, never throw; accepted match is one visible line', () => {
    fc.assert(fc.property(text, text, (label, match) => {
      const r = validateSpec({
        kind: 'summary', title: 't', start: 'a',
        steps: [{ id: 'a', label, status: 'new', source: 'a.ts', match }, { id: 'b', label: 'b', status: 'new', source: 'a.ts:1' }],
        links: [{ from: 'a', to: 'b' }],
      });
      expect(typeof r.ok).toBe('boolean');
      if (r.ok && r.spec.diagram === 'flow') {
        expect(r.spec.steps.map((st) => st.type)).toEqual(['step', 'end']);
        expect((r.spec.steps[0]!.match ?? '').replace(/\t/g, '')).not.toMatch(CONTROL);
        expect(r.spec.steps[0]!.match).not.toMatch(BIDI);
        expect(r.spec.steps[0]!.match).not.toContain('\n');
      }
    }), RUNS);
  });

  it('parseConfigFile never throws on arbitrary input', () => {
    fc.assert(fc.property(json, (v) => {
      expect(typeof parseConfigFile(v).ok).toBe('boolean');
    }), RUNS);
  });

  const globPart = fc.oneof(
    text,
    fc.array(fc.constantFrom('*', '**', '?', '{a,b}', '{', '(', '+(a|b)', '!(x)', '[a-z]', '/', '..', 'a'), { maxLength: 60 }).map((a) => a.join('')),
    fc.nat({ max: 40 }).map((n) => '*?'.repeat(n)),
  );

  it('parseConfigFile with schema-shaped rules and hostile globs/when returns fast without throwing', () => {
    fc.assert(fc.property(fc.array(globPart, { minLength: 1, maxLength: 4 }), text, (paths, when) => {
      const t = Date.now();
      expect(typeof parseConfigFile({ rules: [{ name: 'r', paths }] }).ok).toBe('boolean');
      expect(typeof parseConfigFile({ rules: [{ name: 'r', when }] }).ok).toBe('boolean');
      expect(Date.now() - t).toBeLessThan(1000);
    }), RUNS);
  });

  it('accepted globs contain no braces or extglob groups', () => {
    fc.assert(fc.property(globPart, (g) => {
      const r = parseConfigFile({ rules: [{ name: 'r', paths: [g] }] });
      if (r.ok) expect(g.replace(/\\./g, '')).not.toMatch(/[{(]/);
    }), RUNS);
  });
});
