import type { Flow, Issue } from './business.js';

type Path = (string | number)[];

/** A step ending in "?" is a question: it branches, and every other step leads to at most one. */
export const isQuestion = (text: string): boolean => text.trimEnd().endsWith('?');

/** Lanes, arrows and questions that cannot be drawn: unknown ids, branching steps that are not questions, steps no start leads to. */
export function flowIssues(flow: Flow, issue: Issue): void {
  const lanes = new Set<string>();
  flow.lanes.forEach((l, i) => {
    if (lanes.has(l.id)) issue(['flow', 'lanes', i, 'id'], `duplicate lane "${l.id}"`);
    lanes.add(l.id);
  });
  const index = new Map(flow.steps.map((s, i) => [s.id, i]));
  flow.steps.forEach((s, i) => {
    if (!lanes.has(s.lane)) issue(['flow', 'steps', i, 'lane'], `unknown lane "${s.lane}"`);
  });
  const out = flow.steps.map(() => [] as number[]);
  const incoming = new Set<string>();
  const pairs = new Set<string>();
  flow.arrows.forEach((a, k) => {
    const from = index.get(a.from);
    const to = index.get(a.to);
    if (from === undefined) issue(['flow', 'arrows', k, 'from'], `unknown step "${a.from}"`);
    if (to === undefined) issue(['flow', 'arrows', k, 'to'], `unknown step "${a.to}"`);
    if (from === undefined || to === undefined) return;
    if (from === to) return issue(['flow', 'arrows', k, 'to'], 'a step cannot lead to itself');
    if (pairs.has(`${a.from}>${a.to}`)) return issue(['flow', 'arrows', k, 'to'], `a second arrow from "${a.from}" to "${a.to}"`);
    pairs.add(`${a.from}>${a.to}`);
    out[from]!.push(k);
    incoming.add(a.to);
  });
  flow.steps.forEach((s, i) => {
    const arrows = out[i]!;
    if (isQuestion(s.text)) {
      if (arrows.length < 2) issue(['flow', 'steps', i, 'text'], 'a question needs at least two arrows out, one for each answer; drop the "?" if nothing is asked');
      const labels = new Set<string>();
      for (const k of arrows) {
        const label = flow.arrows[k]!.label;
        if (label === undefined) issue(['flow', 'arrows', k, 'label'], 'label each answer of a question, for example yes or no');
        else if (labels.has(label)) issue(['flow', 'arrows', k, 'label'], `two answers of the same question are both "${label}"`);
        else labels.add(label);
      }
    } else if (arrows.length > 1) {
      issue(['flow', 'steps', i, 'text'], 'only a question can lead to two steps: turn this step into a question (end it with "?") and label each arrow with its answer');
    }
  });
  const starts = flow.steps.filter((s) => !incoming.has(s.id));
  if (!starts.length) return issue(['flow', 'steps'], 'needs a start: a step that no arrow leads to');
  const reached = new Set(starts.map((s) => s.id));
  const queue = [...reached];
  for (const id of queue) {
    for (const k of out[index.get(id)!]!) {
      const to = flow.arrows[k]!.to;
      if (!reached.has(to)) {
        reached.add(to);
        queue.push(to);
      }
    }
  }
  flow.steps.forEach((s, i) => {
    if (!reached.has(s.id)) issue(['flow', 'steps', i, 'id'], `"${s.id}" can never be reached from a start`);
  });
}

/** The reader-visible words of a flow, with their paths. */
export function flowTexts(flow: Flow): { path: Path; text: string }[] {
  return [
    ...flow.lanes.map((l, i) => ({ path: ['flow', 'lanes', i, 'name'], text: l.name })),
    ...flow.steps.map((s, i) => ({ path: ['flow', 'steps', i, 'text'], text: s.text })),
    ...flow.arrows.flatMap((a, i) => (a.label === undefined ? [] : [{ path: ['flow', 'arrows', i, 'label'], text: a.label }])),
  ];
}
