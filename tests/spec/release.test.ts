import { describe, expect, it } from 'vitest';
import { validateAnySpec } from '../../src/spec/schema.js';
import { releaseSpecJsonSchema } from '../../src/spec/release.js';
import { release } from '../fixtures/release.js';

const errors = (spec: unknown): string[] => {
  const r = validateAnySpec(spec);
  return r.ok ? [] : r.errors;
};

describe('release spec', () => {
  it('accepts the sample, including a section with only a summary', () => {
    expect(errors(release())).toEqual([]);
  });

  it('is told apart from a business or map spec by its diagram marker', () => {
    const r = validateAnySpec(release());
    expect(r.ok && r.spec.diagram).toBe('release');
    expect(errors({ ...release(), diagram: 'business' })[0]).toMatch(/summary|journeys|unrecognized/i);
  });

  it('needs 1 to 12 sections', () => {
    expect(errors({ ...release(), sections: [] })).toEqual([expect.stringMatching(/^sections:/)]);
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, title: `Feature ${i}`, change: 'new', summary: 'It works.' }));
    expect(errors({ ...release(), sections: many })).toEqual([expect.stringContaining('at most 12 sections')]);
  });

  it('only takes new, changed or fixed', () => {
    const spec = release();
    spec.sections[0].change = 'removed';
    expect(errors(spec)).toEqual([expect.stringMatching(/^sections\[0\]\.change:/)]);
  });

  it('checks the version and the date', () => {
    expect(errors({ ...release(), version: 'two point oh' })).toEqual([expect.stringMatching(/^version:/)]);
    expect(errors({ ...release(), since: '' })).toEqual([expect.stringMatching(/^since:/)]);
    expect(errors({ ...release(), date: '2026-02-30' })).toEqual([expect.stringMatching(/^date:/)]);
    expect(errors({ ...release(), date: '2026-13-01' })).toEqual([expect.stringMatching(/^date:/)]);
    expect(errors({ ...release(), date: '2026-01-32' })).toEqual([expect.stringMatching(/^date:/)]);
    expect(errors({ ...release(), date: '9 Nov 2026' })).toEqual([expect.stringMatching(/^date:/)]);
  });

  it('caps what a section holds', () => {
    const j = (i: number) => ({ id: `j${i}`, name: `Story ${i}`, now: [{ text: 'Before' }], after: [{ text: 'After' }] });
    const spec = release();
    spec.sections[2].journeys = Array.from({ length: 5 }, (_, i) => j(i));
    expect(errors(spec)).toEqual([expect.stringMatching(/^sections\[2\]\.journeys:/)]);
    spec.sections[2].journeys = [];
    spec.sections[2].rules = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, name: `Rule ${i}`, after: 'It works.' }));
    expect(errors(spec)).toEqual([expect.stringMatching(/^sections\[2\]\.rules:/)]);
  });

  it('has no links on items: one is refused', () => {
    const spec = release();
    spec.sections[1].rules[0].links = ['refund-policy'];
    expect(errors(spec)).toEqual([expect.stringMatching(/^sections\[1\]\.rules\[0\]: .*links/)]);
  });

  it('keeps ids unique across the whole page, sections included', () => {
    const spec = release();
    spec.sections[1].rules[0].id = 'J1';
    spec.sections[2].id = 'refunds';
    expect(errors(spec)).toEqual([expect.stringMatching(/^sections\[2\]\.id: duplicate "refunds"/), expect.stringMatching(/^sections\[1\]\.rules\[0\]\.id: duplicate "J1"/)]);
  });

  it('refuses questions and evidence: the release map only holds checked facts', () => {
    const withQuestion = release();
    withQuestion.sections[0].questions = [{ id: 'Q1', about: 'R1', text: 'Does this apply to trials?', kind: 'other' }];
    const withEvidence = release();
    withEvidence.sections[0].journeys[0].evidence = 'reading';
    withEvidence.sections[1].rules[0].evidence = 'checked';
    withEvidence.sections[1].data[0].evidence = 'checked';
    expect(errors(withQuestion)).toEqual([expect.stringMatching(/^sections\[0\]\.questions: not allowed; a release map only holds facts checked in the code, PR text or diff/)]);
    expect(errors(withEvidence).map((e) => e.split(':')[0])).toEqual(['sections[0].journeys[0].evidence', 'sections[1].rules[0].evidence', 'sections[1].data[0].evidence']);
    expect(errors(withEvidence)[0]).toContain('ask the developer about anything uncertain, or leave it out');
  });

  it('keeps the step rules of business journeys', () => {
    const spec = release();
    spec.sections[0].journeys[0].after[0].change = 'removed';
    expect(errors(spec)).toEqual([expect.stringMatching(/^sections\[0\]\.journeys\[0\]\.after\[0\]\.change:/)]);
  });

  it('runs the plain-words check on every text, section titles and summaries included', () => {
    const spec = release();
    spec.title = 'Release of src/refunds.ts';
    spec.sections[0].title = 'The refundService class';
    spec.sections[1].summary = 'Reads DEFAULT_WINDOW from the settings.';
    spec.sections[0].journeys[0].now[1].text = 'Calls issue_refund() directly';
    spec.sections[1].data[0].why = 'See https://example.com/finance';
    expect(errors(spec).map((e) => e.split(':')[0])).toEqual(['title', 'sections[0].title', 'sections[0].journeys[0].now[1].text', 'sections[1].summary', 'sections[1].data[0].why']);
  });

  it('prints a JSON schema with the sections', () => {
    const schema = releaseSpecJsonSchema() as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toEqual(['diagram', 'title', 'version', 'date', 'since', 'summary', 'sections']);
  });
});
