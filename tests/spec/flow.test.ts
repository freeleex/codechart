import { describe, expect, it } from 'vitest';
import { validateSpec } from '../../src/spec/schema.js';
import { flowJsonSchema, type FlowSpec } from '../../src/spec/flow.js';

const example = (): FlowSpec => ({
  diagram: 'flow',
  kind: 'summary',
  title: 'codechart render',
  rules: ['behaviour-flow'],
  start: 'read',
  steps: [
    { id: 'read', label: 'read file or stdin', type: 'step', status: 'existing', source: 'src/commands/render.ts:82' },
    { id: 'mode', label: 'output mode?', type: 'decision', status: 'changed', source: 'src/commands/render.ts:84-85' },
    { id: 'exit', label: 'exit, no output', type: 'end', status: 'existing', source: 'src/commands/render.ts:86' },
    { id: 'print', label: 'print terminal map', type: 'end', status: 'existing', source: 'src/commands/render.ts:104' },
  ],
  links: [
    { from: 'read', to: 'mode' },
    { from: 'mode', to: 'exit', label: 'none', source: 'src/commands/render.ts:86' },
    { from: 'mode', to: 'print', label: 'cli', source: 'src/commands/render.ts:104' },
  ],
  gaps: ['did not check behaviour when stdin is a TTY'],
});

const errorsOf = (input: unknown) => {
  const r = validateSpec(input);
  if (r.ok) throw new Error('expected validation failure');
  return r.errors;
};

const plan = (): FlowSpec => ({
  ...example(),
  kind: 'plan',
  steps: [
    { id: 'read', label: 'read file', type: 'step', status: 'existing', source: 'a.ts:1' },
    { id: 'mode', label: 'mode?', type: 'decision', status: 'planned' },
    { id: 'a', label: 'do a', type: 'end', status: 'planned' },
    { id: 'b', label: 'do b', type: 'end', status: 'planned' },
  ],
  links: [
    { from: 'read', to: 'mode' },
    { from: 'mode', to: 'a', label: 'x' },
    { from: 'mode', to: 'b', label: 'y' },
  ],
});

describe('validateSpec: flow', () => {
  it('accepts the flow-design example and discriminates by diagram', () => {
    const r = validateSpec(example());
    expect(r.ok && r.spec.diagram).toBe('flow');
  });

  it('accepts a valid plan', () => {
    expect(validateSpec(plan()).ok).toBe(true);
  });

  it('accepts explicit diagram: map', () => {
    expect(validateSpec({ diagram: 'map', title: 't', kind: 'summary', nodes: [], edges: [] }).ok).toBe(true);
  });

  it('keeps map specs without diagram valid', () => {
    const r = validateSpec({ title: 't', kind: 'summary', nodes: [], edges: [] });
    expect(r.ok).toBe(true);
    expect(r.ok && r.spec.diagram).toBeUndefined();
  });

  it('rejects an unknown diagram value', () => {
    expect(validateSpec({ diagram: 'sequence', title: 't', kind: 'plan', nodes: [], edges: [] }).ok).toBe(false);
  });

  describe('statuses', () => {
    it('rejects planned steps in a summary', () => {
      const s = example();
      s.steps[0] = { id: 'read', label: 'read', type: 'step', status: 'planned' };
      expect(errorsOf(s)).toEqual(['steps[0].status: a summary describes code that exists; "planned" is for plans']);
    });

    it('rejects new/changed steps in a plan', () => {
      const s = plan();
      s.steps[0]!.status = 'changed';
      expect(errorsOf(s)).toEqual(['steps[0].status: a plan uses only "existing" or "planned" steps, not "changed"']);
    });
  });

  describe('anchors', () => {
    it('requires source on non-planned steps', () => {
      const s = example();
      delete s.steps[0]!.source;
      expect(errorsOf(s)).toEqual(['steps[0].source: required for a non-planned step (path:line, path:start-end, or a path with match)']);
    });

    it('does not require source on planned steps', () => {
      expect(validateSpec(plan()).ok).toBe(true);
    });

    it.each(['a.ts:1', 'src/a.ts:10-20'])('accepts source %s', (source) => {
      const s = example();
      s.steps[0]!.source = source;
      expect(validateSpec(s).ok).toBe(true);
    });

    it.each(['a.ts:', 'a.ts:x', 'a.ts:1-', 'a b.ts:1', ':3'])('rejects source %s', (source) => {
      const s = example();
      s.steps[0]!.source = source;
      expect(errorsOf(s)).toEqual(['steps[0].source: must be path:line or path:start-end, or a path with match']);
    });

    it('rejects a bare path without match', () => {
      const s = example();
      s.steps[0]!.source = 'a.ts';
      expect(errorsOf(s)).toEqual(['steps[0].source: needs a line (path:line or path:start-end) or a match']);
    });

    it('accepts path plus match on steps and links', () => {
      const s = example();
      s.steps[0] = { ...s.steps[0]!, source: 'src/a.ts', match: 'const x = read()' };
      s.links[1] = { ...s.links[1]!, source: 'src/a.ts', match: 'if (none)' };
      expect(validateSpec(s).ok).toBe(true);
    });

    it('says to quote a single line when match has a newline', () => {
      const s = example();
      s.steps[0] = { ...s.steps[0]!, source: 'src/a.ts', match: 'one\ntwo' };
      expect(errorsOf(s)).toEqual([
        'steps[0].match: must be one line without control or invisible characters (tabs are fine); quote a single line',
      ]);
    });

    it('accepts tabs in match: leading/trailing ones are trimmed, inner ones kept', () => {
      const s = example();
      s.steps[0] = { ...s.steps[0]!, source: 'src/a.go', match: '\treturn x,\terr\t' };
      const r = validateSpec(s);
      if (!r.ok) throw new Error(r.errors.join('\n'));
      expect((r.spec as FlowSpec).steps[0]!.match).toBe('return x,\terr');
    });

    it('rejects match with a :line source', () => {
      const s = example();
      s.steps[0]!.match = 'read';
      expect(errorsOf(s)).toEqual(['steps[0].source: with match, give only the path (no :line)']);
    });

    it('rejects match without source', () => {
      const s = plan();
      s.steps[1]!.match = 'mode';
      expect(errorsOf(s)).toEqual(['steps[1].match: needs source set to the file path']);
    });

    it.each([
      ['', 'must not be blank'],
      ['   ', 'must not be blank'],
      ['x'.repeat(201), 'Too big'],
      ['a\u0007b', 'must be one line without control or invisible characters'],
      ['a\u202eb', 'must be one line without control or invisible characters'],
      ['a\nb', 'must be one line without control or invisible characters'],
    ])('rejects match %j', (match, msg) => {
      const s = example();
      s.steps[0] = { ...s.steps[0]!, source: 'a.ts', match };
      expect(errorsOf(s).join('\n')).toMatch(new RegExp(`steps\\[0\\]\\.match: .*${msg}`, 'i'));
    });

    it('requires source on non-planned decision branches', () => {
      const s = example();
      delete s.links[1]!.source;
      expect(errorsOf(s)).toEqual([
        'links[1].source: required for a non-planned branch leaving a decision (path:line, path:start-end, or a path with match)',
      ]);
    });

    it('planned link flag in a plan needs no source', () => {
      const p = plan();
      p.steps[1] = { id: 'mode', label: 'mode?', type: 'decision', status: 'existing', source: 'a.ts:2' };
      p.links[1]!.planned = true;
      p.steps[2] = { id: 'a', label: 'do a', type: 'end', status: 'existing', source: 'a.ts:3' };
      expect(validateSpec(p).ok).toBe(true);
    });

    it('summary rejects a planned link (no anchor loophole)', () => {
      const s = example();
      delete s.links[1]!.source;
      s.links[1]!.planned = true;
      expect(errorsOf(s)).toEqual(['links[1].planned: a summary describes code that exists; "planned" is for plans']);
    });

    it('branch is planned when only the target is planned', () => {
      const p = plan();
      p.steps[1] = { id: 'mode', label: 'mode?', type: 'decision', status: 'existing', source: 'a.ts:2' };
      expect(validateSpec(p).ok).toBe(true);
    });

    it('non-planned branch to a non-planned end still needs source', () => {
      const p = plan();
      p.steps[1] = { id: 'mode', label: 'mode?', type: 'decision', status: 'existing', source: 'a.ts:2' };
      p.steps[2] = { id: 'a', label: 'do a', type: 'end', status: 'existing', source: 'a.ts:3' };
      expect(errorsOf(p)).toEqual([
        'links[1].source: required for a non-planned branch leaving a decision (path:line, path:start-end, or a path with match)',
      ]);
    });
  });

  describe('decisions', () => {
    it('needs at least 2 outgoing links', () => {
      const s = example();
      s.links.pop();
      expect(errorsOf(s)).toEqual([
        'steps[1].id: decision "mode" needs at least 2 outgoing links, has 1',
        'steps[3]: not reachable from start',
      ]);
    });

    it('needs a label on each outgoing link', () => {
      const s = example();
      delete s.links[2]!.label;
      expect(errorsOf(s)).toEqual(['links[2].label: required on a link leaving a decision']);
    });
  });

  describe('step and end links', () => {
    it('rejects a step with 2 outgoing links', () => {
      const s = example();
      s.steps[0]!.type = 'step';
      s.links.push({ from: 'read', to: 'exit' });
      expect(errorsOf(s)).toEqual([
        'steps[0].type: has 2 outgoing links; make it a decision with labelled branches',
      ]);
    });

    it('rejects an end with outgoing links', () => {
      const s = example();
      s.links.push({ from: 'exit', to: 'read' });
      expect(errorsOf(s)).toEqual(['steps[2].type: an end has no outgoing links, has 1']);
    });
  });

  describe('references', () => {
    it('rejects unknown start', () => {
      const s = example();
      s.start = 'nope';
      expect(errorsOf(s)).toEqual(['start: unknown step "nope"']);
    });

    it('rejects unknown link ends', () => {
      const s = example();
      s.links[0] = { from: 'ghost', to: 'phantom' };
      expect(errorsOf(s)).toEqual([
        'links[0].from: unknown step "ghost"',
        'links[0].to: unknown step "phantom"',
      ]);
    });

    it('rejects duplicate step ids', () => {
      const s = example();
      s.steps[3]!.id = 'exit';
      expect(errorsOf(s)).toContain('steps[3].id: duplicate "exit"');
    });

    it('rejects steps not reachable from start', () => {
      const s = example();
      s.steps.push({ id: 'orphan', label: 'orphan', type: 'end', status: 'existing', source: 'a.ts:1' });
      expect(errorsOf(s)).toEqual(['steps[4]: not reachable from start']);
    });

    it('allows loops', () => {
      const s = example();
      s.steps[3] = { id: 'print', label: 'print terminal map', type: 'step', status: 'existing', source: 'a.ts:1' };
      s.links.push({ from: 'print', to: 'read' });
      expect(validateSpec(s).ok).toBe(true);
    });
  });

  describe('labels', () => {
    const withLabel = (label: string) => {
      const s = example();
      s.steps[0]!.label = label;
      return s;
    };

    it('rejects a hash token', () => {
      expect(errorsOf(withLabel('a91f0c2e7b45_enforce'))[0]).toContain('steps[0].label: looks like a hash or file name ("a91f0c2e7b45")');
    });

    it('rejects merged entities', () => {
      expect(errorsOf(withLabel('read / write'))).toEqual([
        'steps[0].label: one step per entity; split "read / write" into separate steps (one action per step; no \'+\' or \'and\')',
      ]);
    });

    it('allows plain labels', () => {
      expect(validateSpec(withLabel('GET /users/{id}')).ok).toBe(true);
    });
  });

  it('caps steps and links at 200', () => {
    const s = example();
    const extra = Array.from({ length: 200 }, (_, i) => `x${i}`);
    s.steps[3] = { id: 'print', label: 'print terminal map', type: 'step', status: 'existing', source: 'a.ts:1' };
    s.steps.push(...extra.map((id, i) => ({ id, label: id, type: i === 199 ? 'end' : 'step', status: 'existing', source: 'a.ts:1' }) as const));
    s.links.push(...extra.map((id, i) => ({ from: i === 0 ? 'print' : extra[i - 1]!, to: id })));
    expect(errorsOf(s)).toEqual(['steps: at most 200 steps; split the flow', 'links: at most 200 links; split the flow']);
  });

  it('rejects unknown keys', () => {
    expect(validateSpec({ ...example(), nodes: [] }).ok).toBe(false);
  });

  it('exposes a JSON schema', () => {
    expect(flowJsonSchema()).toMatchObject({ type: 'object' });
  });
});

describe('invisible characters in flow ids', () => {
  const msg = 'must not contain control or invisible characters';

  it('rejects a step id that only differs by a bidi mark', () => {
    const s = example();
    s.steps[1]!.id = 'read\u202e';
    expect(errorsOf(s)).toContain(`steps[1].id: ${msg}`);
  });

  it('rejects link ends and start with hidden characters', () => {
    const s = example();
    s.start = 'read\u200b';
    s.links[0]!.to = 'mode\u0007';
    const errs = errorsOf(s);
    expect(errs).toContain(`start: ${msg}`);
    expect(errs).toContain(`links[0].to: ${msg}`);
  });

  it('accepts a normal spec', () => {
    expect(validateSpec(example()).ok).toBe(true);
  });
});
