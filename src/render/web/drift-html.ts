import { CAUSE_LABEL, KIND_PHRASE, type Drift, type DriftItem } from '../drift.js';
import { ageText } from '../terminal/drift-lines.js';
import { esc, num } from './page.js';

/** A summary's differences from its plan, with what the plan had and the build lacks drawn as ghosts. */
export interface Ghosts<G, L> {
  drift: Drift<G>;
  /** Plan nodes or steps not in the build, to lay out and draw faded. */
  nodes: G[];
  /** Plan links between a ghost and anything else on the page. */
  links: L[];
}

/** Ghosts for the plan's missing items the page does not already show; `present`: the ids it shows. */
export function ghostsFor<G extends { id: string }, L extends { from: string; to: string }>(drift: Drift<G>, present: ReadonlySet<string>, planLinks: readonly L[]): Ghosts<G, L> {
  const nodes = drift.items.flatMap((i) => (i.kind === 'missing' && i.ghost && !present.has(i.ghost.id) ? [i.ghost] : []));
  const ghostIds = new Set(nodes.map((g) => g.id));
  const shown = (id: string) => ghostIds.has(id) || present.has(id);
  const links = planLinks.filter((l) => (ghostIds.has(l.from) || ghostIds.has(l.to)) && shown(l.from) && shown(l.to));
  return { drift, nodes, links };
}

export const itemsById = <G>(drift: Drift<G> | undefined): Map<string, DriftItem<G>> => new Map((drift?.items ?? []).map((i) => [i.id, i]));

/** Backticked names become `<code>`. */
const text = (s: string): string => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

const NO_REASON = 'No reason given. Ask the agent why it changed.';
const causeLine = (i: DriftItem<unknown>): string => (i.cause === undefined ? 'No reason given' : CAUSE_LABEL[i.cause]);

const VERB = { add: 'add', change: 'change', remove: 'remove' } as const;
const DID = { add: 'added', change: 'changed', remove: 'removed' } as const;

/** One plain sentence on what differs. */
export function sentence(i: DriftItem<unknown>): string {
  const change = i.change ?? 'change';
  if (i.kind === 'unplanned') return `This ${i.noun} was ${DID[change]}, but the plan didn't include it.`;
  if (i.kind === 'different') return i.plain?.length ? i.plain.join(' ') : 'It was built differently than the plan said.';
  const plan = `The plan said to ${VERB[change]} this ${i.noun}.`;
  if (change === 'remove') return `${plan} ${i.detail ? 'It is still there.' : "It wasn't done."}`;
  return `${plan} ${i.detail === 'left unchanged' ? 'It was left unchanged.' : "It wasn't built."}`;
}

/** The ◆ on a node's bottom-right corner; red when the summary gives no reason. */
export const driftMark = (i: DriftItem<unknown>, x: number, y: number): string =>
  `<text class="drift-mark${i.cause === undefined ? ' bad' : ''}" x="${num(x)}" y="${num(y + 4)}"><title>${esc(`${KIND_PHRASE[i.kind]}. ${causeLine(i)}`)}</title>◆</text>`;

/** The header's line: how many differences, red where some have no reason; green when none. It opens the page info. */
export function driftNote(drift: Drift<unknown> | undefined): string {
  if (!drift) return '';
  if (!drift.items.length) return '<span class="check">built as planned ✓</span>';
  const n = drift.items.length;
  const count = `◆ ${n} ${n === 1 ? 'difference' : 'differences'} from the plan`;
  const bad = drift.unexplained ? ` <span class="bad">· ${drift.unexplained} without a reason</span>` : '';
  return `<button type="button" class="check warn" aria-controls="page-info" title="Show how the build differs from the plan">${count}${bad}</button>`;
}

const ICON = { missing: '−', unplanned: '+', different: '~' } as const;
const row = (label: string, value: string, cls = ''): string => `<span class="drift-l">${label}</span><div class="drift-v${cls}">${value}</div>`;

function whyRow(i: DriftItem<unknown>): string {
  if (i.cause === undefined) return row('Why', `<div class="drift-warn">⚠ ${NO_REASON}</div>`);
  return row('Why', `<span class="drift-pill">${CAUSE_LABEL[i.cause]}</span><div class="drift-note">${esc(i.why ?? '')}</div>`);
}

/** A panel's difference: a chip saying what differs, which opens the plan's side, the build's and the agent's reason. `open`: a ghost has no code to read, so it starts open. */
export function driftSection(i: DriftItem<unknown> | undefined, open = false): string {
  if (!i) return '';
  const rows: string[] = [];
  if (i.kind === 'different') {
    for (const p of i.pairs ?? []) rows.push(row('Plan', text(p.plan), ' drift-plan'), row('Built', text(p.built), ' drift-built'));
  }
  rows.push(whyRow(i));
  return (
    `<div class="drift drift-${i.kind}"><button type="button" class="drift-chip" aria-expanded="${open}"><span class="drift-icon" aria-hidden="true">${ICON[i.kind]}</span>` +
    `<span class="drift-title"><b>${KIND_PHRASE[i.kind]}</b><span class="drift-sub">${text(sentence(i))}</span></span><span class="drift-chev" aria-hidden="true">›</span></button>` +
    `<div class="drift-rows"${open ? '' : ' hidden'}>${rows.join('')}</div></div>`
  );
}

/** The page-info list: each item opens its panel, or the line that says nothing differs. */
export function driftInfo(drift: Drift<unknown> | undefined, now: Date): string {
  if (!drift) return '';
  const title = `“${esc(drift.plan.title)}”`;
  if (!drift.items.length) return `<p class="drift-ok">built as planned ✓ (plan ${title})</p>`;
  const intro = `<p class="drift-why">Compared with the plan ${title} (drawn ${ageText(drift.plan.savedAt, now)}, before the work). codechart saved it then and checks it against what was built.</p>`;
  const rows = drift.items.map(
    (i) =>
      `<li><button type="button" class="rel" data-goto="${esc(i.id)}" data-expand>${esc(i.label)}</button>: ${KIND_PHRASE[i.kind]}<br>` +
      `<span class="drift-why${i.cause === undefined ? ' bad' : ''}">${causeLine(i)}</span></li>`,
  );
  const stray = drift.strayReasons.length ? `<p class="drift-why">⚠ Reasons given for things that match the plan: ${esc(drift.strayReasons.join(', '))}</p>` : '';
  return `<h3>Differences from the plan</h3>${intro}<ul>${rows.join('')}</ul>${stray}`;
}

/** Only in a page with a plan, so a page without one is unchanged. */
export const DRIFT_CSS = `
header button.check.warn{font-family:inherit;color:var(--chg-t);background:none;border:0;padding:0;cursor:pointer;text-decoration:underline dotted}
header .check .bad{color:var(--rem);font-weight:600}
.node .drift-mark{fill:var(--chg-t);font-size:12px;text-anchor:middle}.node .drift-mark.bad{fill:var(--rem)}
.node.ghost :is(.card,.fold,.shape){stroke:var(--muted);stroke-dasharray:4 3;fill:var(--bg);fill-opacity:.5}
.node.ghost :is(.label,.kind,.summary,.field){fill:var(--muted)}
.node.ghost .badge{fill:var(--chg-t);font-size:10px;font-weight:700;letter-spacing:.04em}
.edge.ghost{--base:.5}.edge.ghost path{stroke:var(--muted);stroke-dasharray:4 3}.edge.ghost text{fill:var(--muted)}
aside .drift{margin:10px 0}
aside .drift-missing{--k:var(--chg);--kt:var(--chg-t)}aside .drift-unplanned{--k:var(--edge);--kt:var(--edge)}aside .drift-different{--k:var(--rem);--kt:var(--rem)}
aside .drift-chip{display:flex;width:100%;gap:9px;align-items:flex-start;padding:9px 10px;text-align:left;font:inherit;color:inherit;cursor:pointer;background:color-mix(in srgb,var(--k) 10%,transparent);border:1px solid color-mix(in srgb,var(--k) 30%,transparent);border-radius:8px}
aside .drift-chip[aria-expanded="true"]{border-radius:8px 8px 0 0}
aside .drift-chip:focus{outline:none}aside .drift-chip:focus-visible{box-shadow:0 0 0 2px rgba(121,192,255,.35)}
aside .drift-chip .drift-chev{margin:2px 0 0 auto}aside .drift-chip[aria-expanded="true"] .drift-chev{transform:rotate(90deg)}
aside .drift-icon{flex:none;display:grid;place-items:center;width:22px;height:22px;border-radius:50%;font-weight:700;color:var(--kt);background:color-mix(in srgb,var(--k) 18%,transparent)}
aside .drift-title{display:flex;flex-direction:column;min-width:0}
aside .drift-sub{margin-top:1px;color:var(--muted);font-size:11.5px}
aside .drift-rows{display:grid;grid-template-columns:60px minmax(0,1fr);overflow:hidden;background:var(--bg);border:1px solid color-mix(in srgb,var(--k) 30%,transparent);border-top:0;border-radius:0 0 8px 8px}
aside .drift-rows[hidden]{display:none}
aside .drift-rows>:nth-child(n+3){border-top:1px solid var(--line)}
aside .drift-l{padding:7px 8px;font-size:11px;text-transform:uppercase;color:var(--muted);border-right:1px solid var(--line)}
aside .drift-v{padding:7px 10px;overflow-wrap:anywhere}
aside .drift-plan code{padding:0 3px;border-radius:3px;background:var(--rem-bg);text-decoration:line-through}
aside .drift-built code{padding:0 3px;border-radius:3px;background:var(--add-bg)}
aside .drift-pill{padding:0 8px;font-size:11px;font-weight:600;color:var(--edge);background:color-mix(in srgb,var(--edge) 12%,transparent);border:1px solid color-mix(in srgb,var(--edge) 35%,transparent);border-radius:10px}
aside .drift-chev{color:var(--muted);transition:transform .15s}
aside .drift-note{margin-top:6px;padding:6px 8px;border-left:2px solid var(--edge);background:color-mix(in srgb,var(--edge) 6%,transparent);font-size:12px}
aside .drift-warn{padding:6px 8px;color:var(--rem);background:var(--rem-bg);border:1px solid var(--rem);border-radius:6px}
aside .drift-why{color:var(--muted);font-size:11.5px;margin:0 0 6px}aside li .drift-why{margin:0}
aside .drift-why.bad{color:var(--rem)}aside .drift-ok{color:var(--new-t)}
`;
