import type { ExplainSpec } from './business.js';

type Path = (string | number)[];

/** Every string a reader sees on an explain page, with its path: the ones the plain-words check applies to. */
export function explainTexts(spec: ExplainSpec): { path: Path; text: string }[] {
  return [{ path: ['title'], text: spec.title }, { path: ['summary'], text: spec.summary }, ...explainItemTexts(spec)];
}

function explainItemTexts(spec: ExplainSpec): { path: Path; text: string }[] {
  const out: { path: Path; text: string }[] = [];
  const add = (path: Path, value: string | undefined) => value !== undefined && out.push({ path, text: value });
  spec.journeys.forEach((j, i) => {
    add(['journeys', i, 'name'], j.name);
    add(['journeys', i, 'who'], j.who);
    j.steps.forEach((s, k) => {
      add(['journeys', i, 'steps', k, 'text'], s.text);
      add(['journeys', i, 'steps', k, 'if'], s.if);
    });
  });
  spec.rules.forEach((r, i) => {
    add(['rules', i, 'name'], r.name);
    add(['rules', i, 'rule'], r.rule);
    r.exceptions?.forEach((e, k) => add(['rules', i, 'exceptions', k], e));
  });
  spec.cases.forEach((c, i) => {
    add(['cases', i, 'situation'], c.situation);
    add(['cases', i, 'outcome'], c.outcome);
  });
  spec.data.forEach((d, i) => {
    add(['data', i, 'name'], d.name);
    add(['data', i, 'what'], d.what);
    add(['data', i, 'why'], d.why);
  });
  spec.questions.forEach((q, i) => add(['questions', i, 'text'], q.text));
  return out;
}
