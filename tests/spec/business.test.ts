import { describe, expect, it } from 'vitest';
import { businessSpecJsonSchema } from '../../src/spec/business.js';
import { businessLinkIssues } from '../../src/spec/business-links.js';
import { validateAnySpec } from '../../src/spec/schema.js';
import { business, TECH_IDS } from '../fixtures/business.js';

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
