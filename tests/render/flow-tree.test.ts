import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateFlowSpec, type FlowSpec, type FlowStep } from '../../src/spec/flow.js';
import { FLOW_KEY, renderFlowTree } from '../../src/render/flow/tree.js';
import { columns } from '../../src/render/terminal/wrap.js';

type StepRow = [id: string, label: string, type: FlowStep['type'], status?: FlowStep['status']];
type LinkRow = [from: string, to: string, label?: string, planned?: boolean];

function flow(steps: StepRow[], links: LinkRow[], extra: Partial<FlowSpec> = {}): FlowSpec {
  const spec: FlowSpec = {
    diagram: 'flow',
    kind: 'summary',
    title: 't',
    start: steps[0]![0],
    steps: steps.map(([id, label, type, status = 'existing']) => ({
      id,
      label,
      type,
      status,
      ...(status === 'planned' ? {} : { source: 'a.ts:1' }),
    })),
    links: links.map(([from, to, label, planned]) => ({
      from,
      to,
      ...(label ? { label, source: 'a.ts:2' } : {}),
      ...(planned ? { planned } : {}),
    })),
    ...extra,
  };
  const r = validateFlowSpec(spec);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.spec;
}

const renderFlow = flow(
  [
    ['read', 'read file or stdin', 'step'],
    ['validate', 'validate spec', 'step'],
    ['config', 'load config', 'step'],
    ['mode', 'output mode?', 'decision', 'changed'],
    ['exit', 'exit, no output', 'end'],
    ['cli', 'print terminal map', 'end'],
    ['size', 'hidden nodes or ≥ 8 nodes?', 'decision', 'new'],
    ['small', 'print terminal map', 'end'],
    ['html', 'write HTML', 'step', 'changed'],
    ['prune', 'prune old HTML', 'step'],
    ['open', '--open?', 'decision'],
    ['browser', 'open browser', 'step'],
    ['print', 'print map or link', 'end'],
  ],
  [
    ['read', 'validate'],
    ['validate', 'config'],
    ['config', 'mode'],
    ['mode', 'exit', 'none'],
    ['mode', 'cli', 'cli'],
    ['mode', 'size', 'auto'],
    ['mode', 'html', 'web|both'],
    ['size', 'small', 'no'],
    ['size', 'html', 'yes'],
    ['html', 'prune'],
    ['prune', 'open'],
    ['open', 'browser', 'yes'],
    ['open', 'print', 'no'],
    ['browser', 'print'],
  ],
  { title: 'codechart render', gaps: ['did not check behaviour when stdin is a TTY'] },
);

const opts = { maxNodes: 30, width: 80, color: false };

describe('renderFlowTree', () => {
  it('draws the render flow from flow-design §9', () => {
    const { text, truncated } = renderFlowTree(renderFlow, opts);
    expect(text).toBe(
      [
        'read file or stdin → validate spec → load config',
        '◇ ~output mode?',
        '├─ none     → exit, no output',
        '├─ cli      → print terminal map',
        '├─ auto     → ◇ +hidden nodes or ≥ 8 nodes?',
        '│             ├─ no  → print terminal map',
        '│             └─ yes → ⤷ ~write HTML',
        '└─ web|both → ⤷ ~write HTML',
        '',
        '⤷ ~write HTML → prune old HTML',
        '◇ --open?',
        '├─ yes → open browser → ⤷ print map or link',
        '└─ no  → ⤷ print map or link',
        '',
        '⤷ print map or link',
        '',
        '13 steps · 1 new · 2 changed · 0 planned',
        FLOW_KEY,
        'gaps: did not check behaviour when stdin is a TTY',
        '',
      ].join('\n'),
    );
    expect(truncated).toBe(false);
    expect(text).toMatchSnapshot();
  });

  it('draws a loop once, as a shared block', () => {
    const spec = flow(
      [
        ['fetch', 'fetch token', 'step'],
        ['req', 'send request', 'step'],
        ['parse', 'parse reply', 'step'],
        ['ok', 'ok?', 'decision'],
        ['done', 'done', 'end'],
      ],
      [
        ['fetch', 'req'],
        ['req', 'parse'],
        ['parse', 'ok'],
        ['ok', 'req', 'no'],
        ['ok', 'done', 'yes'],
      ],
    );
    expect(renderFlowTree(spec, opts).text.split('\n\n').slice(0, 2)).toEqual([
      'fetch token → ⤷ send request',
      ['⤷ send request → parse reply', '◇ ok?', '├─ no  → ⤷ send request', '└─ yes → done'].join('\n'),
    ]);
  });

  it('terminates when the start step is a loop target', () => {
    const spec = flow(
      [
        ['a', 'poll', 'step'],
        ['more', 'more?', 'decision'],
        ['end', 'stop', 'end'],
      ],
      [
        ['a', 'more'],
        ['more', 'a', 'yes'],
        ['more', 'end', 'no'],
      ],
    );
    expect(renderFlowTree(spec, opts).text.split('\n\n')[0]).toBe(
      ['⤷ poll', '◇ more?', '├─ yes → ⤷ poll', '└─ no  → stop'].join('\n'),
    );
  });

  it('draws a shared decision reached from two branches', () => {
    const spec = flow(
      [
        ['a', 'which job?', 'decision'],
        ['x', 'job x', 'step'],
        ['y', 'job y', 'step'],
        ['more', 'more?', 'decision'],
        ['z', 'stop', 'end'],
      ],
      [
        ['a', 'x', 'x'],
        ['a', 'y', 'y'],
        ['x', 'more'],
        ['y', 'more'],
        ['more', 'a', 'yes'],
        ['more', 'z', 'no'],
      ],
    );
    expect(renderFlowTree(spec, opts).text.split('\n\n').slice(0, 2)).toEqual([
      ['⤷ ◇ which job?', '├─ x → job x → ⤷ more?', '└─ y → job y → ⤷ more?'].join('\n'),
      ['⤷ ◇ more?', '├─ yes → ⤷ which job?', '└─ no  → stop'].join('\n'),
    ]);
  });

  it('prints a step reached from 3 places once', () => {
    const spec = flow(
      [
        ['in', 'read input', 'step'],
        ['kind', 'kind?', 'decision'],
        ['a', 'parse json', 'step'],
        ['b', 'parse yaml', 'step'],
        ['save', 'save result', 'step'],
        ['log', 'log', 'end'],
      ],
      [
        ['in', 'kind'],
        ['kind', 'a', 'json'],
        ['kind', 'b', 'yaml'],
        ['kind', 'save', 'raw'],
        ['a', 'save'],
        ['b', 'save'],
        ['save', 'log'],
      ],
    );
    const { text } = renderFlowTree(spec, opts);
    expect(text.split('\n\n').slice(0, 2)).toEqual([
      [
        'read input',
        '◇ kind?',
        '├─ json → parse json → ⤷ save result',
        '├─ yaml → parse yaml → ⤷ save result',
        '└─ raw  → ⤷ save result',
      ].join('\n'),
      '⤷ save result → log',
    ]);
    expect(text.match(/⤷ save result/g)).toHaveLength(4);
  });

  it('titles a plan with planned steps and marks planned steps and branches', () => {
    const spec = flow(
      [
        ['read', 'read spec', 'step'],
        ['kind', 'diagram?', 'decision'],
        ['map', 'render map', 'end'],
        ['tree', 'render flow tree', 'step', 'planned'],
        ['skip', 'skip', 'end'],
        ['out', 'print', 'end', 'planned'],
      ],
      [
        ['read', 'kind'],
        ['kind', 'map', 'map'],
        ['kind', 'tree', 'flow'],
        ['kind', 'skip', 'none', true],
        ['tree', 'out'],
      ],
      { kind: 'plan' },
    );
    const { text } = renderFlowTree(spec, opts);
    expect(text).toMatchSnapshot();
    expect(text.split('\n').slice(0, 6)).toEqual([
      'planned flow',
      'read spec',
      '◇ diagram?',
      '├─ map   → render map',
      '├─ ?flow → ?render flow tree → ?print',
      '└─ ?none → skip',
    ]);
    expect(text).toContain('6 steps · 0 new · 0 changed · 2 planned');
  });

  it('does not title a plan with no planned steps', () => {
    const spec = flow([['a', 'a', 'step'], ['b', 'b', 'end']], [['a', 'b']], { kind: 'plan' });
    expect(renderFlowTree(spec, opts).text.startsWith('a → b\n')).toBe(true);
  });

  it('marks a planned link between existing steps with ?→ and titles the plan', () => {
    const spec = flow(
      [['a', 'a', 'step'], ['b', 'b', 'step'], ['c', 'c', 'end']],
      [['a', 'b', undefined, true], ['b', 'c']],
      { kind: 'plan' },
    );
    const { text } = renderFlowTree(spec, opts);
    expect(text.split('\n').slice(0, 2)).toEqual(['planned flow', 'a ?→ b → c']);
  });

  it('keeps the ?→ marker when a run wraps', () => {
    const spec = flow(
      [['a', 'aaaaaaaaaaaaaaaa', 'step'], ['b', 'bbbbbbbbbbbbbbbb', 'end']],
      [['a', 'b', undefined, true]],
      { kind: 'plan' },
    );
    const { text } = renderFlowTree(spec, { ...opts, width: 24 });
    expect(text).toContain('aaaaaaaaaaaaaaaa\n  ?→ bbbbbbbbbbbbbbbb');
  });

  it('previews at a budget of 5, counting cut steps', () => {
    const htmlPath = '/tmp/x/render.html';
    const { text, truncated } = renderFlowTree(renderFlow, { ...opts, maxNodes: 5, htmlPath });
    expect(truncated).toBe(true);
    expect(text.replace(pathToFileURL(resolve(htmlPath)).href, 'file:///tmp/x/render.html')).toMatchSnapshot();
    expect(text.split('\n\n')[0]).toBe(
      [
        'read file or stdin → validate spec → load config',
        '◇ ~output mode?',
        '├─ none     → exit, no output',
        '├─ cli      → … (+1 steps in web view)',
        '├─ auto     → … (+7 steps in web view)',
        '└─ web|both → …',
      ].join('\n'),
    );
    expect(text.trimEnd().split('\n').at(-1)).toBe(`full map → ${pathToFileURL(resolve(htmlPath)).href}`);
  });

  it('says "not shown" for cut steps when no HTML was written', () => {
    const { text } = renderFlowTree(renderFlow, { ...opts, maxNodes: 5 });
    expect(text).toContain('├─ cli      → … (+1 steps not shown)');
  });

  it('says the flow is too large when the start run and first decision do not fit', () => {
    expect(renderFlowTree(renderFlow, { ...opts, maxNodes: 3 })).toEqual({
      text: 'flow too large for the terminal; use --output both or web\n',
      truncated: true,
    });
    const htmlPath = '/tmp/x/render.html';
    expect(renderFlowTree(renderFlow, { ...opts, maxNodes: 3, htmlPath }).text).toBe(
      `full map → ${pathToFileURL(resolve(htmlPath)).href}\n`,
    );
  });

  it('marks a branch into a planned step with ?, without planned: true', () => {
    const spec = flow(
      [['d', 'd?', 'decision'], ['a', 'a', 'end'], ['b', 'b', 'end', 'planned']],
      [['d', 'a', 'yes'], ['d', 'b', 'no']],
      { kind: 'plan' },
    );
    const { text } = renderFlowTree(spec, opts);
    expect(text).toContain('├─ yes → a\n└─ ?no → ?b');
  });

  it('counts steps not reachable from start as cut', () => {
    const spec = flow([['a', 'a', 'step'], ['b', 'b', 'end']], [['a', 'b']]);
    spec.steps.push({ id: 'c', label: 'c', type: 'end', status: 'existing', source: 'a.ts:1' });
    const { text, truncated } = renderFlowTree(spec, opts);
    expect(truncated).toBe(true);
    expect(text.startsWith('a → b\n… (+1 steps not shown)\n')).toBe(true);
  });

  it('fits every line in 40 columns, cutting with …', () => {
    const { text, truncated } = renderFlowTree(renderFlow, { ...opts, width: 40 });
    expect(text).toMatchSnapshot();
    for (const line of text.split('\n')) expect(columns(line)).toBeLessThanOrEqual(40);
    expect(text).toContain('…');
    expect(truncated).toBe(true);
  });

  it('wraps a long run onto → continuation lines without cutting', () => {
    const { text, truncated } = renderFlowTree(renderFlow, { ...opts, width: 40 });
    expect(text.split('\n').slice(0, 2)).toEqual(['read file or stdin → validate spec', '  → load config']);
    expect(truncated).toBe(true);
  });

  it('fits every line at the 20-column minimum', () => {
    const { text } = renderFlowTree(renderFlow, { ...opts, width: 5 });
    for (const line of text.split('\n').filter((l) => !l.startsWith('full map'))) {
      expect(columns(line)).toBeLessThanOrEqual(20);
    }
  });

  it('prints a paste-ready --md block', () => {
    const htmlPath = '/tmp/x/a (1).html';
    const { text } = renderFlowTree(renderFlow, { ...opts, md: true, htmlPath });
    const lines = text.split('\n');
    expect(lines[0]).toBe('**Flow** _(key: + new  ~ changed  ? planned  ◇ decision  ⤷ shared step)_');
    expect(lines.slice(1, 4)).toEqual(['```text', 'codechart render', '────────────────']);
    expect(text).not.toContain(FLOW_KEY + '\n');
    expect(text).not.toContain('full map →');
    expect(text.endsWith(`\`\`\`\n\n[Open full map](${pathToFileURL(resolve(htmlPath)).href.replace('(', '%28').replace(')', '%29')})\n`)).toBe(true);
  });

  it('keeps the --md title inside the fence so it cannot add links or images', () => {
    const title = '[click](https://evil) ![](https://track/p.png) ```';
    const { text } = renderFlowTree({ ...renderFlow, title }, { ...opts, md: true });
    const lines = text.split('\n');
    expect(lines[0]).toBe(`**Flow** _(${FLOW_KEY})_`);
    expect(lines[1]).toBe('````text');
    expect(lines[2]).toBe(title);
  });

  it('reports a cut --md title as truncated so the full view is written', () => {
    const title = 'a very long flow title '.repeat(5);
    expect(renderFlowTree({ ...renderFlow, title }, { ...opts, md: true }).truncated).toBe(true);
    expect(renderFlowTree({ ...renderFlow, title }, opts).truncated).toBe(false);
    expect(renderFlowTree(renderFlow, { ...opts, md: true }).truncated).toBe(false);
  });

  it('paints labels only when color is on', () => {
    const plain = renderFlowTree(renderFlow, opts).text;
    expect(plain).not.toContain('\u001b');
    const painted = renderFlowTree(renderFlow, { ...opts, color: true }).text;
    expect(painted).toContain('\u001b[33m~output mode?\u001b[0m');
    expect(painted).toContain('read file or stdin →');
    expect(painted.replace(/\u001b\[[0-9;]*m/g, '')).toBe(plain);
  });
});
