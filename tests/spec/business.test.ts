import { describe, expect, it } from 'vitest';
import { businessSpecJsonSchema } from '../../src/spec/business.js';
import { businessLinkIssues } from '../../src/spec/business-links.js';
import { validateAnySpec } from '../../src/spec/schema.js';
import { business, businessExplain, EXPLAIN_TECH_IDS, TECH_IDS } from '../fixtures/business.js';

const check = (spec: unknown) => validateAnySpec(spec);
const errors = (spec: unknown): string[] => {
  const r = check(spec);
  return r.ok ? [] : r.errors;
};

describe('business spec', () => {
  it('accepts the sample', () => {
    expect(check(business()).ok).toBe(true);
  });

  it('needs the business diagram marker', () => {
    const spec = business();
    delete spec.diagram;
    expect(check(spec).ok).toBe(false);
  });

  it('needs a journey, rule or saved data item', () => {
    const spec = { ...business(), journeys: [], rules: [], data: [], questions: [] };
    expect(errors(spec)).toEqual([expect.stringContaining('at least one journey, rule or saved data item')]);
  });

  it('lets every list but one stay out', () => {
    const { journeys } = business();
    expect(check({ diagram: 'business', title: 'T', summary: 'S', journeys }).ok).toBe(true);
  });

  it('rejects an item without links', () => {
    const spec = business();
    spec.rules[0].links = [];
    expect(errors(spec)).toEqual([expect.stringMatching(/^rules\[0\]\.links: .*boxes/)]);
  });

  it('rejects an unknown evidence value and a missing one', () => {
    const spec = business();
    spec.data[0].evidence = 'guess';
    delete spec.rules[1].evidence;
    expect(errors(spec).map((e) => e.split(':')[0])).toEqual(['rules[1].evidence', 'data[0].evidence']);
  });

  it('rejects a removed step in after and a new step in now', () => {
    const spec = business();
    spec.journeys[0].after[0].change = 'removed';
    spec.journeys[0].now[0].change = 'new';
    expect(errors(spec).map((e) => e.split(':')[0])).toEqual(['journeys[0].now[0].change', 'journeys[0].after[0].change']);
  });

  it('allows an empty now or after, not both', () => {
    const spec = business();
    spec.journeys[1].now = [];
    expect(check(spec).ok).toBe(true);
    spec.journeys[1].after = [];
    expect(errors(spec)).toEqual([expect.stringMatching(/^journeys\[1\]\.after: needs steps/)]);
  });

  it('rejects a question about an unknown item, and one about a question', () => {
    const spec = business();
    spec.questions[0].about = 'R9';
    expect(errors(spec)).toEqual(['questions[0].about: unknown journey, rule or saved data item "R9"']);
    spec.questions[0].about = 'Q1';
    expect(errors(spec)).toHaveLength(1);
  });

  it('rejects duplicate ids across all kinds of item', () => {
    const spec = business();
    spec.rules[0].id = 'J1';
    spec.questions[0].id = 'D1';
    expect(errors(spec)).toEqual(['rules[0].id: duplicate "J1"', 'questions[0].id: duplicate "D1"']);
  });

  it.each([
    ['journeys', 9, (i: number) => ({ ...business().journeys[0], id: `J${i}` })],
    ['rules', 13, (i: number) => ({ ...business().rules[0], id: `R${i}` })],
    ['data', 9, (i: number) => ({ ...business().data[0], id: `D${i}` })],
    ['questions', 8, (i: number) => ({ ...business().questions[0], id: `Q${i}`, about: 'R1' })],
  ])('caps %s', (key, n, make) => {
    const spec = { ...business(), [key]: Array.from({ length: n }, (_, i) => make(i + 10)) };
    expect(errors(spec).some((e) => e.startsWith(`${key}:`))).toBe(true);
  });

  it('caps steps and exceptions', () => {
    const spec = business();
    spec.journeys[0].now = Array.from({ length: 11 }, () => ({ text: 'A step' }));
    spec.rules[0].exceptions = Array.from({ length: 6 }, () => 'An exception');
    expect(errors(spec).map((e) => e.split(':')[0])).toEqual(['journeys[0].now', 'rules[0].exceptions']);
  });

  it('rejects unknown properties', () => {
    const spec = business();
    spec.rules[0].techRefs = ['x'];
    expect(errors(spec)).toEqual([expect.stringMatching(/^rules\[0\]: .*techRefs/)]);
  });

  it('checks the words of every text field, with the path', () => {
    const spec = business();
    spec.title = 'Fix in refund.ts';
    spec.journeys[0].after[1].text = 'Agent calls refundNow';
    spec.rules[0].exceptions = ['Set FEATURE_FLAG first'];
    spec.questions[0].text = 'Is it safe?​';
    expect(errors(spec).map((e) => e.split(':')[0])).toEqual(['title', 'journeys[0].after[1].text', 'rules[0].exceptions[0]', 'questions[0].text']);
  });

  it('prints the schema', () => {
    expect(JSON.stringify(businessSpecJsonSchema())).toContain('"business"');
  });
});

describe('business links', () => {
  const boxes = TECH_IDS.map((id) => ({ id, label: id }));

  it('accepts links to boxes of the tech map', () => {
    expect(businessLinkIssues(business() as never, boxes)).toEqual([]);
  });

  it('names a link that is not a box', () => {
    const spec = business();
    spec.journeys[1].links[0] = 'refund-api';
    expect(businessLinkIssues(spec as never, boxes)).toEqual(['journeys[1].links[0]: "refund-api" is not a box on the tech map']);
  });

  it('does not print a secret-looking link in full', () => {
    const spec = business();
    spec.journeys[1].links[0] = 'ghp_abcdefghijklmnop1234';
    const [issue] = businessLinkIssues(spec as never, boxes);
    expect(issue).toBe('journeys[1].links[0]: "ghp_…" is not a box on the tech map');
  });

  it('rejects a multi-word tech id copied into prose, not a single word', () => {
    const spec = business();
    spec.rules[0].after = 'The subscription-model decides it; refunds stay open.';
    spec.rules[1].after = 'Approvals wait for the manager.';
    expect(businessLinkIssues(spec as never, boxes)).toEqual(['rules[0].after: names a box of the tech map ("subscription-model"); write it in plain words']);
  });

  it('catches the id written with spaces apart or underscores', () => {
    const spec = business();
    spec.rules[0].after = 'See subscription_model for details.';
    expect(businessLinkIssues(spec as never, boxes)).toHaveLength(1);
  });
});

describe('business explain spec', () => {
  const edit = (change: (raw: ReturnType<typeof businessExplain>) => void): string[] => {
    const raw = businessExplain();
    change(raw);
    return errors(raw);
  };

  it('accepts the sample', () => {
    expect(errors(businessExplain())).toEqual([]);
  });

  it('needs a flow', () => {
    const { diagram, kind, title, summary } = businessExplain();
    expect(errors({ diagram, kind, title, summary })).toEqual([expect.stringMatching(/^flow/)]);
  });

  it('refuses journeys, questions and before and after on a rule, in plain words', () => {
    const spec = businessExplain();
    spec.journeys = [];
    spec.questions = [];
    spec.rules[0].before = 'x';
    expect(errors(spec)).toEqual([
      'journeys: an explain page draws one flow, not journeys; use flow with lanes, steps and arrows',
      'questions: explain pages have no open questions; the reader asks the team',
      'rules[0].before: an explain page has no before and after; use rule',
    ]);
  });

  it('refuses a flow in a change map, and kind and cases too', () => {
    expect(errors({ ...business(), flow: businessExplain().flow })).toEqual(['flow: only on an explain page (kind "explain"); a change map has journeys']);
    expect(errors({ ...business(), cases: [] })).toEqual(['cases: only on an explain page (kind "explain")']);
    expect(errors({ ...business(), kind: 'change' })).toEqual(['kind: only "explain" is allowed here; leave it out for a change map']);
  });

  it('needs a rule in the explain shape', () => {
    const spec = businessExplain();
    delete spec.rules[0].rule;
    expect(errors(spec)).toEqual([expect.stringMatching(/^rules\[0\]\.rule/)]);
  });

  it('rejects an id used twice across steps, rules, cases and saved data', () => {
    expect(edit((raw) => (raw.cases[0].id = 'R1'))).toEqual(['cases[0].id: duplicate "R1"']);
    expect(edit((raw) => (raw.data[0].id = 'S1'))).toEqual(['data[0].id: duplicate "S1"']);
    expect(edit((raw) => (raw.flow.steps[1].id = 'S1'))).toContain('flow.steps[1].id: duplicate "S1"');
  });

  it('keeps lanes to 5, steps to 16 and a step to one short action', () => {
    expect(edit((raw) => (raw.flow.lanes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, name: id }))))).toEqual([expect.stringMatching(/^flow\.lanes/)]);
    expect(edit((raw) => (raw.flow.steps[0].text = 'ab '.repeat(21)))).toEqual(['flow.steps[0].text: keep each step to one short action (60 characters at most)']);
    expect(edit((raw) => (raw.flow.lanes = [])).length).toBeGreaterThan(0);
    const many = edit((raw) => {
      raw.flow.steps = Array.from({ length: 17 }, (_, i) => ({ id: `s${i}`, text: `Step ${i}`, lane: 'customer', links: ['api'], evidence: 'checked' }));
      raw.flow.arrows = [];
    });
    expect(many).toEqual([expect.stringMatching(/^flow\.steps/)]);
  });

  it('refuses an unknown lane, an unknown step in an arrow, a self-loop and a repeated arrow', () => {
    expect(edit((raw) => (raw.flow.steps[0].lane = 'ghost'))).toEqual(['flow.steps[0].lane: unknown lane "ghost"']);
    expect(edit((raw) => (raw.flow.arrows[0].to = 'ghost'))).toContain('flow.arrows[0].to: unknown step "ghost"');
    expect(edit((raw) => raw.flow.arrows.push({ from: 'S1', to: 'S1' }))).toEqual(['flow.arrows[5].to: a step cannot lead to itself']);
    expect(edit((raw) => raw.flow.arrows.push({ from: 'S1', to: 'S2' }))).toEqual(['flow.arrows[5].to: a second arrow from "S1" to "S2"']);
    expect(edit((raw) => raw.flow.lanes.push({ id: 'customer', name: 'Again' }))).toEqual(['flow.lanes[2].id: duplicate lane "customer"']);
  });

  it('makes a step ending in "?" a question: two or more arrows out, each labelled once', () => {
    expect(edit((raw) => raw.flow.arrows.splice(3, 1))).toEqual(['flow.steps[2].text: a question needs at least two arrows out, one for each answer; drop the "?" if nothing is asked']);
    expect(edit((raw) => delete raw.flow.arrows[2].label)).toEqual(['flow.arrows[2].label: label each answer of a question, for example yes or no']);
    expect(edit((raw) => (raw.flow.arrows[3].label = 'yes'))).toEqual(['flow.arrows[3].label: two answers of the same question are both "yes"']);
  });

  it('allows at most 3 answers to a question', () => {
    const add = (raw: ReturnType<typeof businessExplain>) => {
      raw.flow.steps.push({ id: 'S7', text: 'Credit it', lane: 'billing', links: ['api'], evidence: 'checked' }, { id: 'S8', text: 'Hold it', lane: 'billing', links: ['api'], evidence: 'checked' });
      raw.flow.arrows.push({ from: 'S3', to: 'S7', label: 'partly' }, { from: 'S3', to: 'S8', label: 'later' });
    };
    expect(edit(add)).toEqual(['flow.steps[2].text: a question can have at most 3 answers']);
    expect(edit((raw) => {
      add(raw);
      raw.flow.arrows.pop();
    })).toEqual([]);
  });

  it('lets only a question branch, and tells the agent to turn the step into one', () => {
    expect(edit((raw) => raw.flow.arrows.push({ from: 'S1', to: 'S4' }))).toEqual(['flow.steps[0].text: only a question can lead to two steps: turn this step into a question (end it with "?") and label each arrow with its answer']);
  });

  it('needs a start, and refuses steps no start reaches', () => {
    expect(edit((raw) => raw.flow.arrows.push({ from: 'S6', to: 'S1' }))).toEqual(['flow.steps: needs a start: a step that no arrow leads to'].map(() => expect.stringMatching(/^flow\.steps: needs a start/)) as never);
    expect(
      edit((raw) => {
        raw.flow.steps.push({ id: 'a', text: 'Loops one way', lane: 'billing', links: ['api'], evidence: 'checked' }, { id: 'b', text: 'Loops back', lane: 'billing', links: ['api'], evidence: 'checked' });
        raw.flow.arrows.push({ from: 'a', to: 'b' }, { from: 'b', to: 'a' });
      }),
    ).toEqual(['flow.steps[6].id: "a" can never be reached from a start', 'flow.steps[7].id: "b" can never be reached from a start']);
  });

  it('allows several starts and a loop back to a step the flow started from', () => {
    expect(
      edit((raw) => {
        raw.flow.steps.push({ id: 'cron', text: 'Month end comes', lane: 'billing', links: ['api'], evidence: 'checked' });
        raw.flow.arrows.push({ from: 'cron', to: 'S2' });
      }),
    ).toEqual([]);
    expect(edit((raw) => raw.flow.arrows.push({ from: 'S6', to: 'S2' }))).toEqual([]);
  });

  it('checks the plain words of lanes, steps, answers and cases', () => {
    const spec = businessExplain();
    spec.flow.lanes[0].name = 'refundWindow';
    spec.flow.steps[1].text = 'Calls createInvoice now';
    spec.flow.arrows[2].label = 'is_zero';
    spec.cases[0].outcome = 'Calls createInvoice';
    expect(errors(spec)).toEqual([
      expect.stringMatching(/^flow\.lanes\[0\]\.name: looks like code/),
      expect.stringMatching(/^flow\.steps\[1\]\.text: looks like code/),
      expect.stringMatching(/^flow\.arrows\[2\]\.label: looks like code/),
      expect.stringMatching(/^cases\[0\]\.outcome: looks like code/),
    ]);
  });

  it('checks the links of steps, including flow steps, and tech ids in the words', () => {
    const r = check(businessExplain());
    if (!r.ok || r.spec.diagram !== 'business') throw new Error('fixture');
    expect(businessLinkIssues(r.spec, EXPLAIN_TECH_IDS.map((id) => ({ id, label: id })))).toEqual([]);
    expect(businessLinkIssues(r.spec, [{ id: 'api', label: 'api' }]).filter((m) => m.startsWith('flow'))).toEqual([
      'flow.steps[2].links[0]: "flow:create/zero" is not a box on the tech map',
      'flow.steps[3].links[0]: "flow:create/skip" is not a box on the tech map',
      'flow.steps[4].links[0]: "stripe" is not a box on the tech map',
      'flow.steps[5].links[0]: "email" is not a box on the tech map',
    ]);
    const spec = businessExplain();
    delete spec.flow.steps[0].links;
    expect(errors(spec)).toEqual([expect.stringMatching(/^flow\.steps\[0\]\.links/)]);
  });

  it('has its own JSON schema, with the flow and without journeys and questions', () => {
    const schema = businessSpecJsonSchema(true) as { properties: Record<string, { const?: string }> };
    expect(schema.properties.kind!.const).toBe('explain');
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['flow', 'cases', 'rules']));
    expect(Object.keys(schema.properties)).not.toContain('journeys');
    expect(Object.keys(schema.properties)).not.toContain('questions');
  });
});
