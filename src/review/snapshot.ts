import { createHash } from 'node:crypto';
import type { DriftItem } from '../render/drift.js';
import type { FlowSnippets } from '../render/flow/anchors.js';
import type { Preview } from '../render/preview.js';
import { sanitizeText } from '../render/strip.js';
import { diffRev } from '../render/web/tools.js';
import { gitDirtyHashes, gitHead } from '../rules/git-files.js';
import { hasGitSelection, type GitSelection } from '../rules/selection.js';
import type { BusinessSpec } from '../spec/business.js';
import type { FlowSpec, FlowStep } from '../spec/flow.js';
import type { ReleaseSpec } from '../spec/release.js';
import type { Spec } from '../spec/schema.js';
import type { Range, ReviewNode } from './schema.js';
import type { ReviewSnapshot } from './store.js';

const MAX_DIRTY = 2000;

const clean = (s: string): string => sanitizeText(s);

interface Extras {
  edges: { from: string; to: string; label?: string }[];
  gaps?: string[];
  omitted?: string[];
}

/** What a map shows besides its nodes, for notes on it; a list with nothing in it is left out. */
function extrasOf(drift: readonly DriftItem<unknown>[] | undefined, x: Extras): Pick<ReviewSnapshot, 'drift' | 'edges' | 'gaps' | 'omitted'> {
  const text = (list: string[] | undefined) => list?.map(clean);
  const gaps = text(x.gaps);
  const omitted = text(x.omitted);
  return {
    ...(drift?.length && { drift: drift.map((d) => ({ id: clean(d.id), kind: d.kind, label: clean(d.label) })) }),
    ...(x.edges.length && { edges: x.edges.map((e) => ({ from: clean(e.from), to: clean(e.to), ...(e.label && { label: clean(e.label) }) })) }),
    ...(gaps?.length && { gaps }),
    ...(omitted?.length && { omitted }),
  };
}

/** What the map showed, per node: the diff lines at render time and their hash. Text from the repo is sanitized: it reaches the terminal. */
export function mapSnapshot(spec: Spec, previews: Map<string, Preview> | undefined, range: Range | undefined, drift?: readonly DriftItem<unknown>[], ghostLinks: Extras['edges'] = []): ReviewSnapshot {
  const nodes = spec.nodes.map((n): ReviewNode => {
    const p = previews?.get(n.id);
    const path = p?.path ?? n.path;
    const lines = p?.lines.map((l) => ({ ...l, text: clean(l.text) }));
    return { id: n.id, label: clean(n.label), ...(path && { path: clean(path) }), ...(p && { rev: diffRev(p), lines, ...(p.note && { note: clean(p.note) }) }) };
  });
  return { kind: 'map', title: clean(spec.title), nodes, ...(range && { range }), ...extrasOf(drift, { edges: [...spec.edges, ...ghostLinks], gaps: spec.gaps, omitted: spec.omitted }) };
}

const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 12);

/** A step's hash covers what its panel shows: label, status, type, source, its code and its outgoing links with theirs. */
export function stepRev(spec: FlowSpec, step: FlowStep, snippets: FlowSnippets): string {
  const { id, label, status, type, source, match } = step;
  const next = spec.links.flatMap((l, i) => (l.from === id ? [{ to: l.to, label: l.label, source: l.source, match: l.match, planned: l.planned, removed: l.removed, code: snippets.links[i] }] : []));
  return hash({ label, status, type, source, match, code: snippets.steps.get(id), next });
}

export function flowSnapshot(spec: FlowSpec, snippets: FlowSnippets, range: Range | undefined, drift?: readonly DriftItem<unknown>[], ghostLinks: Extras['edges'] = []): ReviewSnapshot {
  const nodes = spec.steps.map((s): ReviewNode => {
    const path = s.source?.replace(/:\d+(?:-\d+)?$/, '');
    return { id: s.id, label: clean(s.label), ...(path && { path: clean(path) }), rev: stepRev(spec, s, snippets) };
  });
  return { kind: 'flow', title: clean(spec.title), nodes, ...(range && { range }), ...extrasOf(drift, { edges: [...spec.links, ...ghostLinks], gaps: spec.gaps }) };
}

const REV_FIELDS = {
  journey: ['name', 'who', 'now', 'after', 'links'],
  rule: ['name', 'before', 'after', 'exceptions', 'links'],
  data: ['name', 'what', 'why', 'links'],
  question: ['about', 'text'],
} as const;

/** An item's hash covers its words and links, so a confirmation of the old words never counts for new ones; 6 characters keep the page's token short. */
export function businessRev(kind: keyof typeof REV_FIELDS, item: object): string {
  const fields = item as Record<string, unknown>;
  return hash(REV_FIELDS[kind].map((f) => fields[f])).slice(0, 6);
}

interface Named {
  id: string;
  name: string;
  links?: string[];
}

interface PageItems {
  journeys: Named[];
  rules: Named[];
  data: Named[];
  questions: { id: string; text: string; about: string }[];
}

function itemsSnapshot(title: string, spec: PageItems): ReviewSnapshot {
  const items = [
    ...spec.journeys.map((x) => ({ ...x, item: 'journey' as const })),
    ...spec.rules.map((x) => ({ ...x, item: 'rule' as const })),
    ...spec.data.map((x) => ({ ...x, item: 'data' as const })),
  ];
  const linksOf = new Map(items.map((x) => [x.id, x.links ?? []]));
  const linked = (links: string[]) => (links.length ? { links: links.map(clean) } : {});
  const nodes = items.map((x) => ({ id: clean(x.id), label: clean(x.name), item: x.item, rev: businessRev(x.item, x), ...linked(x.links ?? []) }));
  const questions = spec.questions.map((q) => ({ id: clean(q.id), label: clean(q.text), item: 'question' as const, rev: businessRev('question', q), about: clean(q.about), ...linked(linksOf.get(q.about) ?? []) }));
  return { kind: 'business', title: clean(title), nodes: [...nodes, ...questions] };
}

/** A business page takes notes on its items: journeys, rules, saved data and questions, by id. */
export function businessSnapshot(spec: BusinessSpec): ReviewSnapshot {
  return itemsSnapshot(spec.title, spec);
}

/** A release page is a business page to the review: the items of all its sections, by id (unique across the page). */
export function releaseSnapshot(spec: ReleaseSpec): ReviewSnapshot {
  const all = spec.sections;
  return itemsSnapshot(spec.title, { journeys: all.flatMap((s) => s.journeys), rules: all.flatMap((s) => s.rules), data: all.flatMap((s) => s.data), questions: all.flatMap((s) => s.questions) });
}

/** Where the code stood at render time, for the review's stale check; none for a commit, which never changes, or `--head`, which is not HEAD. */
export function rangeOf(root: string, sel: GitSelection): Range | undefined {
  if (!hasGitSelection(sel) || sel.commit !== undefined || sel.head !== undefined) return undefined;
  return currentRange(root, sel.git === true);
}

function currentRange(root: string, worktree: boolean): Range {
  const dirty = worktree ? gitDirtyHashes(root, MAX_DIRTY) : undefined;
  const hash = dirty && createHash('sha256').update(JSON.stringify(Object.entries(dirty).sort())).digest('hex').slice(0, 12);
  const head = gitHead(root);
  return { worktree, ...(head && { head }), ...(hash && { dirty: hash }) };
}

/** The code moved since the page was rendered. */
export function isStale(root: string, stored: Range | undefined): boolean {
  if (!stored) return false;
  try {
    const now = currentRange(root, stored.worktree);
    return now.head !== stored.head || now.dirty !== stored.dirty;
  } catch {
    return false;
  }
}
