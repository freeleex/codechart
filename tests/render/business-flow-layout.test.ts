import { describe, expect, it } from 'vitest';
import { flowDiagram } from '../../src/render/business/flow-diagram.js';
import { layoutFlow, type Pt } from '../../src/render/business/flow-layout.js';
import { businessExplain, refundsFlow } from '../fixtures/business.js';

interface Seg {
  edge: number;
  a: Pt;
  b: Pt;
}

const segments = (flow: Parameters<typeof layoutFlow>[0]): Seg[] =>
  layoutFlow(flow).edges.flatMap((e, edge) => e.points.slice(1).map((b, i) => ({ edge, a: e.points[i]!, b })));

const range = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)];
const overlap = (p: [number, number], q: [number, number]): number => Math.min(p[1], q[1]) - Math.max(p[0], q[0]);

/** Segments of different arrows on one line, or parallel closer than `gap` with a shared stretch. */
function clashes(segs: Seg[], gap: number): string[] {
  const out: string[] = [];
  segs.forEach((s, i) =>
    segs.slice(i + 1).forEach((t) => {
      if (s.edge === t.edge) return;
      const sv = s.a.x === s.b.x;
      const tv = t.a.x === t.b.x;
      if (sv !== tv) return;
      const [across, along] = sv ? (['x', 'y'] as const) : (['y', 'x'] as const);
      if (Math.abs(s.a[across] - t.a[across]) >= gap) return;
      if (overlap(range(s.a[along], s.b[along]), range(t.a[along], t.b[along])) > 0) out.push(`${s.edge}/${t.edge} at ${sv ? 'x' : 'y'}=${s.a[across]}`);
    }),
  );
  return out;
}

describe('flow layout', () => {
  it('gives every refunds arrow its own run: none shares a line or runs within 10px of another', () => {
    const flow = refundsFlow() as Parameters<typeof layoutFlow>[0];
    expect(layoutFlow(flow).edges).toHaveLength(7);
    expect(clashes(segments(flow), 10)).toEqual([]);
  });

  it('keeps the fixture flow clean too, and one with a loop back', () => {
    const flow = businessExplain().flow;
    expect(clashes(segments(flow), 10)).toEqual([]);
    const loop = refundsFlow();
    loop.arrows.push({ from: 'S7', to: 'S1' } as never);
    expect(clashes(segments(loop as never), 10)).toEqual([]);
  });

  it('draws text at body size: nodes 13px or more, answers 12px, lane names 11px', () => {
    const svg = flowDiagram(refundsFlow() as never);
    const sizes = (cls: string): number[] => [...svg.matchAll(new RegExp(`class="${cls}[^"]*" font-size="(\\d+)"`, 'g'))].map((m) => Number(m[1]));
    expect(sizes('nt').length).toBe(7);
    expect(Math.min(...sizes('nt'))).toBeGreaterThanOrEqual(13);
    expect(Math.min(...sizes('elab'))).toBeGreaterThanOrEqual(12);
    expect(Math.min(...sizes('lane'))).toBeGreaterThanOrEqual(11);
    expect(svg).not.toMatch(/min-width|max-width|scale/);
  });

  it('spreads arrows into one step along its left side', () => {
    const into = layoutFlow(refundsFlow() as never).edges.slice(5).map((e) => e.points.at(-1)!.y);
    expect(new Set(into).size).toBe(2);
    expect(Math.abs(into[0]! - into[1]!)).toBeGreaterThanOrEqual(10);
  });
});

const flowOf = (laneNames: string[], steps: [string, number, string][], arrows: [string, string, string?][]) =>
  ({
    lanes: laneNames.map((name, i) => ({ id: `L${i}`, name })),
    steps: steps.map(([id, lane, text]) => ({ id, text, lane: `L${lane}`, links: ['api'], evidence: 'checked' as const })),
    arrows: arrows.map(([from, to, label]) => ({ from, to, ...(label && { label }) })),
  }) as Parameters<typeof layoutFlow>[0];

describe('flow text fits', () => {
  const words = ['Reconciliation', 'Authorization', 'Verification', 'Registration'];
  const long = 'Reconciliation Authorization Verification Registration';
  const decode = (svg: string): string => svg.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&');

  it('shows a 60-character step of long words and a 30-character lane name in full', () => {
    const step = 'Verification Authorization Registration Reconciliation ab';
    expect(step.length).toBeLessThanOrEqual(60);
    const flow = flowOf(['Alpha Bravo Delta Echo Fox Golf Hotel', 'Intake Review Final Sign Off'], [['A', 0, step], ['B', 1, `${step.slice(0, 50)}?`], ['C', 1, 'Done']], [['A', 'B'], ['B', 'C', 'yes'], ['B', 'A', 'no']]);
    flow.lanes[0]!.name = 'Alpha Bravo Delta Echo Fox Go';
    const svg = flowDiagram(flow);
    expect(svg).not.toContain('…');
    const text = decode(svg).replace(/\s+/g, ' ');
    for (const w of step.split(' ')) expect(text).toContain(w);
    for (const w of 'ALPHA BRAVO DELTA ECHO FOX GO'.split(' ')) expect(text).toContain(w);
    const nodes = layoutFlow(flow).nodes;
    expect(nodes[0]!.lines.join(' ')).toBe(step);
  });

  it('never cuts a lane name of four long words or a step of long words', () => {
    const flow = flowOf([words.slice(0, 2).join(' ').slice(0, 30)], [['A', 0, long.slice(0, 60)], ['B', 0, 'End']], [['A', 'B']]);
    const svg = flowDiagram(flow);
    expect(svg).not.toContain('…');
    expect(layoutFlow(flow).nodes[0]!.lines.join(' ')).toBe(long.slice(0, 54).trim());
  });
});

describe('question exits', () => {
  const cases: [string, number[], string[][]][] = [
    ['two answers, one lane', [0, 0, 0], [['Q', 'Y', 'yes'], ['Q', 'N', 'no']]],
    ['three answers, one lane', [0, 0, 0, 0], [['Q', 'Y', 'full'], ['Q', 'M', 'partial'], ['Q', 'N', 'credit']]],
    ['two answers, across lanes', [0, 1, 2], [['Q', 'Y', 'yes'], ['Q', 'N', 'no']]],
    ['three answers, across lanes', [1, 0, 1, 2], [['Q', 'Y', 'full'], ['Q', 'M', 'partial'], ['Q', 'N', 'credit']]],
  ];
  it.each(cases)('%s: every answer leaves from its own point with its own label spot', (_, lanes, arrows) => {
    const steps: [string, number, string][] = [['Q', lanes[0]!, 'Is it right?'], ...arrows.map((a, i): [string, number, string] => [a[1]!, lanes[i + 1]!, `Then ${a[1]}`])];
    const layout = layoutFlow(flowOf(['A', 'B', 'C'], steps, arrows as [string, string, string?][]));
    expect(layout.edges).toHaveLength(arrows.length);
    const starts = layout.edges.map((e) => `${e.points[0]!.x},${e.points[0]!.y}`);
    const spots = layout.edges.map((e) => `${e.label!.at.x},${e.label!.at.y}`);
    expect(new Set(starts).size).toBe(arrows.length);
    expect(new Set(spots).size).toBe(arrows.length);
    expect(clashes(layout.edges.flatMap((e, edge) => e.points.slice(1).map((b, i) => ({ edge, a: e.points[i]!, b }))), 10)).toEqual([]);
  });
});

describe('lane names', () => {
  it('keep whole words and make room for them: the label column never reaches the first column', () => {
    const flow = flowOf(['Sales representative', 'Customer administrator'], [['A', 0, 'Asks'], ['B', 1, 'Answers']], [['A', 'B']]);
    const layout = layoutFlow(flow);
    expect(layout.lanes.map((l) => l.lines)).toEqual([['SALES', 'REPRESENTATIVE'], ['CUSTOMER', 'ADMINISTRATOR']]);
    const svg = flowDiagram(flow);
    for (const w of ['SALES', 'REPRESENTATIVE', 'CUSTOMER', 'ADMINISTRATOR']) expect(svg).toContain(`>${w}<`);
    const first = Math.min(...layout.nodes.map((n) => n.cx - n.w / 2));
    expect(14 + 'REPRESENTATIVE'.length * 8.4).toBeLessThan(first);
    const narrow = layoutFlow(flowOf(['Sales'], [['A', 0, 'Asks'], ['B', 0, 'Answers']], [['A', 'B']]));
    expect(Math.min(...narrow.nodes.map((n) => n.cx - n.w / 2))).toBeLessThan(first);
  });
});

describe('answers of one question', () => {
  type Segment = [Pt, Pt];
  const meets = ([p, q]: Segment, [r, s]: Segment): boolean => {
    const box = (a: Pt, b: Pt) => ({ x: range(a.x, b.x), y: range(a.y, b.y) });
    const u = box(p, q);
    const v = box(r, s);
    return overlap(u.x, v.x) >= 0 && overlap(u.y, v.y) >= 0;
  };
  const cases: [string, number[]][] = [
    ['one lane', [0, 0, 0, 0]],
    ['targets in lanes above and below', [1, 0, 1, 2]],
    ['all targets in lanes below', [0, 1, 2, 2]],
    ['all targets in lanes above', [2, 1, 0, 0]],
  ];
  it.each(cases)('3 answers, %s: no answer arrow touches another', (_, lanes) => {
    const arrows: [string, string, string][] = [['Q', 'Y', 'full'], ['Q', 'M', 'partial'], ['Q', 'N', 'credit']];
    const steps: [string, number, string][] = [['Q', lanes[0]!, 'Is it right?'], ...arrows.map((a, i): [string, number, string] => [a[1], lanes[i + 1]!, `Then ${a[1]}`])];
    const { edges } = layoutFlow(flowOf(['A', 'B', 'C'], steps, arrows));
    const segs = edges.map((e) => e.points.slice(1).map((b, i): Segment => [e.points[i]!, b]));
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) for (const s of segs[i]!) for (const t of segs[j]!) expect(meets(s, t), `${i}/${j}`).toBe(false);
  });
});

describe('answers that loop back', () => {
  const answers = (loop: boolean) => {
    const arrows: [string, string, string][] = [['Q', 'F', 'no'], ['Q', 'S', 'yes'], ['Q', 'R', 'unsure']];
    return loop ? arrows : arrows.slice(1);
  };
  const build = (arrows: [string, string, string][]) =>
    flowOf(['A'], [['F', 0, 'Fill form'], ['Q', 0, 'Valid?'], ['S', 0, 'Saved'], ['R', 0, 'Review']].filter((s) => s[0] === 'F' || s[0] === 'Q' || arrows.some((a) => a[1] === s[0])) as [string, number, string][], [['F', 'Q'], ...arrows]);
  const exitsOf = (flow: ReturnType<typeof build>) => Object.fromEntries(layoutFlow(flow).edges.filter((e) => e.from === 'Q').map((e) => [e.to, `${e.points[0]!.x},${e.points[0]!.y}`]));

  it.each([2, 3])('%i answers, loop back listed first: the right exit goes forward and nothing is shared', (n) => {
    const arrows = answers(true).slice(0, n);
    const flow = build(arrows);
    const layout = layoutFlow(flow);
    const q = layout.nodes.find((x) => x.id === 'Q')!;
    const right = `${q.cx + q.w / 2},${q.cy}`;
    expect(exitsOf(flow).S).toBe(right);
    expect(exitsOf(flow).F).not.toBe(right);
    expect(clashes(segments(flow), 10)).toEqual([]);
  });

  it('gives each answer the same exit whatever the order of the arrows', () => {
    const perms = (xs: [string, string, string][]): [string, string, string][][] => (xs.length < 2 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
    for (const loop of [true, false]) {
      const base = answers(loop);
      const seen = new Set(perms(base).map((p) => {
        const flow = build(p);
        const e = exitsOf(flow);
        return JSON.stringify(Object.keys(e).sort().map((k) => [k, e[k]]));
      }));
      expect(seen.size).toBe(1);
    }
  });
});

describe('loop backs and skips from one question', () => {
  const perms = <T,>(xs: T[]): T[][] => (xs.length < 2 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
  type Arrow3 = [string, string, string?];
  const lane = (name: string, ids: string[]): [string, number, string][] => ids.map((id) => [id, 0, `${name} ${id}`]);
  const flows: [string, [string, number, string][], Arrow3[]][] = [
    ['two loop backs', [['S', 0, 'Start'], ['C', 0, 'Check'], ['Q', 0, 'Again?']], [['S', 'C'], ['C', 'Q'], ['Q', 'S', 'from start'], ['Q', 'C', 'recheck']]],
    ['three loop backs', [...lane('Step', ['A', 'B', 'C']), ['Q', 0, 'Again?']], [['A', 'B'], ['B', 'C'], ['C', 'Q'], ['Q', 'A', 'one'], ['Q', 'B', 'two'], ['Q', 'C', 'three']]],
    ['forward, skip and loop back', [['A', 0, 'Start'], ['Q', 0, 'Again?'], ['N', 0, 'Next'], ['K', 0, 'Skip'], ['E', 0, 'End']], [['A', 'Q'], ['Q', 'N', 'ok'], ['Q', 'E', 'later'], ['Q', 'A', 'redo'], ['N', 'K'], ['K', 'E']]],
    ['two skips and one forward', [['Q', 0, 'Which?'], ['N', 0, 'Near'], ['M', 0, 'Mid'], ['F', 0, 'Far'], ['E', 0, 'End']], [['Q', 'N', 'a'], ['Q', 'F', 'c'], ['Q', 'E', 'b'], ['N', 'M'], ['M', 'F'], ['F', 'E']]],
    ['loop back across lanes', [['S', 0, 'Start'], ['C', 1, 'Check'], ['Q', 2, 'Again?'], ['E', 2, 'End']], [['S', 'C'], ['C', 'Q'], ['Q', 'S', 'from start'], ['Q', 'C', 'recheck'], ['Q', 'E', 'done']]],
  ];
  const touches = (p: [Pt, Pt], q: [Pt, Pt]): boolean => overlap(range(p[0].x, p[1].x), range(q[0].x, q[1].x)) >= 0 && overlap(range(p[0].y, p[1].y), range(q[0].y, q[1].y)) >= 0;

  it.each(flows)('%s: answers never cross, whatever the order of the arrows, and the picture is the same', (_, steps, arrows) => {
    const pictures = new Set<string>();
    for (const order of perms(arrows)) {
      const flow = flowOf(['A', 'B', 'C'], steps, order as [string, string, string?][]);
      const layout = layoutFlow(flow);
      const mine = layout.edges.filter((e) => e.from === 'Q').map((e) => e.points.slice(1).map((b, i): [Pt, Pt] => [e.points[i]!, b]));
      for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) for (const s of mine[i]!) for (const t of mine[j]!) expect(touches(s, t), `${i}/${j}`).toBe(false);
      expect(clashes(segments(flow), 5)).toEqual([]);
      pictures.add(flowDiagram(flow));
    }
    expect(pictures.size).toBe(1);
  });
});

describe('answer labels', () => {
  const longest = 'The customer paid a diff';
  const cases: [string, number[]][] = [
    ['one lane', [0, 0, 0, 0]],
    ['across lanes', [1, 0, 1, 2]],
    ['all below', [0, 1, 2, 2]],
    ['all above', [2, 1, 0, 0]],
  ];
  it.each(cases)('a longest-allowed label, %s: clear of every step and inside the picture', (_, lanes) => {
    expect(longest).toHaveLength(24);
    const arrows: [string, string, string][] = [['Q', 'Y', longest], ['Q', 'M', `${longest.slice(0, 23)}x`], ['Q', 'N', `${longest.slice(0, 22)}xy`]];
    const steps: [string, number, string][] = [['Q', lanes[0]!, 'Is it right?'], ...arrows.map((a, i): [string, number, string] => [a[1], lanes[i + 1]!, `Then ${a[1]}`])];
    const layout = layoutFlow(flowOf(['A', 'B', 'C'], steps, arrows));
    const labels = layout.edges.map((e) => e.label!.box);
    expect(labels).toHaveLength(3);
    for (const b of labels) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(layout.width);
      expect(b.y + b.h).toBeLessThanOrEqual(layout.height);
      for (const n of layout.nodes) {
        const nearX = Math.min(Math.max(n.cx, b.x), b.x + b.w);
        const nearY = Math.min(Math.max(n.cy, b.y), b.y + b.h);
        const inside = n.kind === 'question' ? Math.abs(nearX - n.cx) / (n.w / 2) + Math.abs(nearY - n.cy) / (n.h / 2) < 1 : Math.abs(nearX - n.cx) < n.w / 2 && Math.abs(nearY - n.cy) < n.h / 2;
        expect(inside, `${b.x},${b.y} vs ${n.id}`).toBe(false);
      }
    }
  });

  it('puts every label clear of the lines that leave the question', () => {
    const arrows: [string, string, string][] = [['Q', 'Y', longest], ['Q', 'M', 'no'], ['Q', 'N', 'maybe']];
    const steps: [string, number, string][] = [['Q', 0, 'Is it right?'], ['Y', 0, 'Then Y'], ['M', 1, 'Then M'], ['N', 1, 'Then N']];
    const layout = layoutFlow(flowOf(['A', 'B'], steps, arrows));
    const verticals = layout.edges.flatMap((e) => e.points.slice(1).map((b, i) => [e.points[i]!, b] as const)).filter(([p, q]) => p.x === q.x);
    for (const { label } of layout.edges) {
      const b = label!.box;
      for (const [p, q] of verticals) {
        const crosses = p.x > b.x && p.x < b.x + b.w && Math.min(p.y, q.y) < b.y + b.h && Math.max(p.y, q.y) > b.y;
        expect(crosses, label!.text).toBe(false);
      }
    }
  });
});

describe('many arrows into one step', () => {
  it('gives eight branches that join a short step eight separate entry points', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `B${i}`);
    const flow = flowOf(['A'], [...ids.map((id): [string, number, string] => [id, 0, `Branch ${id}`]), ['D', 0, 'Done']], ids.map((id): [string, string] => [id, 'D']));
    const layout = layoutFlow(flow);
    const ends = layout.edges.map((e) => e.points.at(-1)!);
    expect(new Set(ends.map((p) => `${p.x},${p.y}`)).size).toBe(8);
    const ys = ends.map((p) => p.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(10);
    const done = layout.nodes.find((n) => n.id === 'D')!;
    expect(ys[0]!).toBeGreaterThan(done.cy - done.h / 2);
    expect(ys.at(-1)!).toBeLessThan(done.cy + done.h / 2);
    expect(clashes(segments(flow), 10)).toEqual([]);
  });
});
