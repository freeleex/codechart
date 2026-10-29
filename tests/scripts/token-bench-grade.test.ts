import { describe, expect, it } from 'vitest';
import { gradeRun, isIncomplete } from '../../scripts/bench-grade.js';

const MAP = '**Map** _(key: + new)_\n```text\nbackend\n  +a ─calls─▶ +b\n\n2 nodes\n```';
const FLOW = '**Flow** _(key: + new)_\n```text\nDo a thing\n──────────\n+step\n\n1 steps\n```\n\n[Open full map](file:///x/y.html)';

function run(renderResults: { text: string; error?: boolean; command?: string }[], reply: string) {
  const events: Record<string, unknown>[] = [];
  renderResults.forEach((r, i) => {
    events.push({ type: 'assistant', message: { id: `m${i}`, content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command: r.command ?? "codechart render --md - <<'EOF'" } }] } });
    events.push({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, is_error: r.error ?? false, content: r.text }] } });
  });
  events.push({ type: 'result', result: reply });
  return events;
}

describe('token-bench grader', () => {
  it('passes a byte-exact paste of every output, including two from one call', () => {
    const g = gradeRun(run([{ text: `${MAP}\n${FLOW}` }], `Intro.\n\n${MAP}\n\n${FLOW}\n\nProse.`), '2-summary');
    expect(g).toEqual({ outputs: 2, pasted: 2, extraHeaders: 0, unrendered: 0, shown: true, firstRenderOk: true, trivialSkip: null });
  });

  it('a trailing blank line after each output is not an edit', () => {
    const g = gradeRun(run([{ text: `${MAP}\n\n${FLOW}\n\n` }], `${MAP}\n\n${FLOW}\n`), '2-summary');
    expect(g).toMatchObject({ outputs: 2, pasted: 2, unrendered: 0 });
  });

  it('fails an edited paste and counts bare header lines, not prose that starts with **Map**', () => {
    const edited = FLOW.replace('+step', '+ step');
    const prose = '**Map**: the endpoint a now calls b through the new helper, and the old path is gone.';
    const reply = `**Map**\n${MAP}\n\n## **Flow**\n${edited}\n\n**Map** (what changed)\n**Flow** _Do a thing_\n\n${prose}`;
    expect(gradeRun(run([{ text: `${MAP}\n${FLOW}` }], reply), '2-summary')).toMatchObject({ outputs: 2, pasted: 1, extraHeaders: 4 });
  });

  it('grades only the last output per diagram title and flags a failed first render', () => {
    const v1 = MAP.replace('2 nodes', '2 nodes · old');
    const g = gradeRun(run([{ text: 'Exit code 1\nnodes[0].kind: invalid', error: true }, { text: v1 }, { text: MAP }], MAP), '3-plan');
    expect(g).toMatchObject({ outputs: 1, pasted: 1, firstRenderOk: false });
  });

  it('treats the output-none notice as a clean render', () => {
    expect(gradeRun(run([{ text: 'codechart: no map drawn: its rules (x) resolve to output none' }], 'Done.'), '2-summary')).toMatchObject({ outputs: 0, firstRenderOk: true });
  });

  it('trivial skip: passes with no diagram, fails when one is shown or a render was attempted', () => {
    expect(gradeRun(run([], 'A typo fix.'), '4-trivial').trivialSkip).toBe(true);
    expect(gradeRun(run([{ text: MAP }], MAP), '4-trivial').trivialSkip).toBe(false);
    expect(gradeRun(run([{ text: 'Exit code 1\nnodes[0].kind: invalid', error: true }], 'A typo fix.'), '4-trivial').trivialSkip).toBe(false);
  });

  it('keys outputs by spec title, so two maps with the same first line both count', () => {
    const other = MAP.replace('+b', '+c');
    const command = `codechart render --md - <<'EOF'\n{ "title": "One" }\nEOF\ncodechart render --md - <<'EOF'\n{ "title": "Two" }\nEOF`;
    const g = gradeRun(run([{ text: `${MAP}\n${other}`, command }], MAP), '2-summary');
    expect(g).toMatchObject({ outputs: 2, pasted: 1 });
  });

  it('matches a link whose path has parentheses', () => {
    const flow = FLOW.replace('/x/y.html', '/x (copy)/y.html');
    expect(gradeRun(run([{ text: flow }], `${flow}\n`), '1-flow')).toMatchObject({ outputs: 1, pasted: 1 });
    expect(gradeRun(run([{ text: flow }], flow.replace(' (copy)', '')), '1-flow')).toMatchObject({ outputs: 1, pasted: 0 });
  });

  it('flags diagram blocks that no render printed: edited key, split header, hand-drawn tree; not plain code blocks', () => {
    const results = [{ text: `nodes[0].kind: invalid\n${FLOW}` }];
    const ok = gradeRun(run(results, `${FLOW}\n\n\`\`\`text\ndry run: would write x\n\`\`\``), '2-summary');
    expect(ok).toMatchObject({ unrendered: 0, shown: true });
    expect(gradeRun(run(results, FLOW.replace('+ new', '+ new  ? planned')), '2-summary')).toMatchObject({ unrendered: 1, pasted: 0, shown: false });
    expect(gradeRun(run(results, FLOW.replace('**Flow** ', '**Flow**\n')), '2-summary').unrendered).toBe(1);
    expect(gradeRun(run(results, `${FLOW}\n\nAlso:\n\`\`\`\n◇ ok?\n├─ yes → done\n\`\`\``), '2-summary').unrendered).toBe(1);
    expect(gradeRun(run([], MAP), '2-summary')).toMatchObject({ unrendered: 1, shown: false });
  });

  it('recognizes a link-only web output and a fence longer than three backticks', () => {
    const web = '**Map** _(key: + new)_\n\n[Open full map](file:///x/y.html)';
    const long = '**Flow** _(key: + new)_\n````text\nA ``` title\n──────────\n+step\n````';
    expect(gradeRun(run([{ text: web }], `${web}\n`), '2-summary')).toMatchObject({ outputs: 1, pasted: 1, unrendered: 0 });
    expect(gradeRun(run([{ text: long }], `${long}\n`), '1-flow')).toMatchObject({ outputs: 1, pasted: 1, unrendered: 0 });
  });

  it('marks runs without a clean result event as incomplete', () => {
    const ok = { exitCode: 0, events: [{ type: 'result', result: 'x' }] };
    expect(isIncomplete(ok)).toBe(false);
    expect(isIncomplete({ ...ok, events: [{ type: 'assistant' }] })).toBe(true);
    expect(isIncomplete({ ...ok, exitCode: 124 })).toBe(true);
    expect(isIncomplete({ ...ok, events: [{ type: 'result', is_error: true }] })).toBe(true);
  });
});
