import path from 'node:path';
import picomatch from 'picomatch';
import { builtinRules } from '../config/builtin-rules.js';
import { BUILTIN_DEFAULTS } from '../config/load.js';
import type { Config, ContextMode, Diagram, Output, Rule } from '../config/schema.js';

interface PathMatch {
  rule: string;
  diagram: Diagram;
  files: string[];
  output: Output;
  context?: ContextMode;
}

interface MapFinal {
  draw: boolean;
  output: Output;
  context: ContextMode;
  rules: string[];
}

type FlowFinal = Omit<MapFinal, 'context'>;

export interface CheckResult {
  pathMatches: PathMatch[];
  excludedFiles: Record<Diagram, string[]>;
  remainingFiles: Record<Diagram, string[]>;
  toJudge: ToJudge[];
  /** `--matched` names no rule in the config has: no `final` until the agent judges `toJudge` and reruns. */
  unknownMatched?: string[];
  final?: { map: MapFinal; flow: FlowFinal };
}

export interface ToJudge {
  rule: string;
  diagram: Diagram;
  when: string;
  output: Output;
  context?: ContextMode;
}

interface Contribution {
  rule: string;
  diagram: Diagram;
  output: Output;
  context?: ContextMode;
}

const DRIVE_PATH = /^[A-Za-z]:\//;

export function normalizePath(p: string, root: string): string {
  const slashed = p.replace(/\\/g, '/').replace(/^\.\//, '');
  const rootSlashed = root.replace(/\\/g, '/');
  if (DRIVE_PATH.test(slashed)) {
    if (!DRIVE_PATH.test(rootSlashed)) return slashed;
    // Drive letters are case-insensitive; the rest of the path is not.
    const relative = path.posix.relative(lowerDrive(rootSlashed), lowerDrive(slashed));
    return isInside(relative) ? relative : slashed;
  }
  if (!path.posix.isAbsolute(slashed)) return slashed;
  const relative = path.posix.relative(rootSlashed, slashed);
  return isInside(relative) ? relative : slashed;
}

function lowerDrive(p: string): string {
  return p.charAt(0).toLowerCase() + p.slice(1);
}

function isInside(relative: string): boolean {
  return relative !== '' && relative !== '..' && !relative.startsWith('../');
}

function isPathRule(rule: Rule): rule is Rule & { paths: string[] } {
  return rule.paths !== undefined;
}

const diagramOf = (rule: Rule): Diagram => rule.diagram ?? 'map';

function toContribution(rule: Rule, config: Pick<Config, 'defaults'>): Contribution {
  const diagram = diagramOf(rule);
  const output = rule.output ?? config.defaults.output;
  if (diagram === 'flow') return { rule: rule.name, diagram, output };
  return { rule: rule.name, diagram, output, context: rule.context ?? config.defaults.context };
}

function matchPathRules(config: Config, rules: Rule[], files: string[]) {
  const pathRules = rules.filter(isPathRule).map((rule) => ({
    rule,
    isMatch: picomatch(rule.paths, { dot: true, nobrace: true, noextglob: true }),
  }));
  const filesByRule = new Map<string, string[]>();
  for (const file of files) {
    const hit = pathRules.find(({ isMatch }) => isMatch(file));
    if (!hit) continue;
    const list = filesByRule.get(hit.rule.name);
    if (list) list.push(file);
    else filesByRule.set(hit.rule.name, [file]);
  }
  return pathRules.flatMap(({ rule }): PathMatch[] => {
    const matchedFiles = filesByRule.get(rule.name);
    return matchedFiles ? [{ ...toContribution(rule, config), files: matchedFiles }] : [];
  });
}

// auto counts as cli plus a conditional web.
export function unionOutputs(outputs: Output[]): Output {
  const hasAuto = outputs.includes('auto');
  const hasCli = hasAuto || outputs.some((o) => o === 'cli' || o === 'both');
  const hasWeb = outputs.some((o) => o === 'web' || o === 'both');
  if (hasCli && hasWeb) return 'both';
  if (hasAuto) return 'auto';
  if (hasCli) return 'cli';
  if (hasWeb) return 'web';
  return 'none';
}

function buildFlowFinal(contributions: Contribution[]): FlowFinal {
  const drawing = contributions.filter((c) => c.output !== 'none');
  const output = unionOutputs(drawing.map((c) => c.output));
  return { draw: output !== 'none', output, rules: drawing.map((c) => c.rule) };
}

function buildMapFinal(config: Config, contributions: Contribution[]): MapFinal {
  const anyFull = contributions.some((c) => c.output !== 'none' && c.context === 'full');
  return { ...buildFlowFinal(contributions), context: anyFull ? 'full' : config.defaults.context };
}

function findPlainRules(config: Config, matched: string[]): { rules: Rule[]; unknown: string[] } {
  const wanted = new Set(matched);
  const unknown: string[] = [];
  for (const name of wanted) {
    const rule = config.rules.find((r) => r.name === name);
    if (!rule) unknown.push(name);
    else if (isPathRule(rule)) throw new Error(`not a plain-language rule: ${name}`);
  }
  return { rules: config.rules.filter((r) => wanted.has(r.name)), unknown };
}

function resolveDiagram(config: Config, diagram: Diagram, files: string[], plainMatches: Rule[]) {
  const ofType = (r: Rule) => diagramOf(r) === diagram;
  const pathMatches = matchPathRules(config, config.rules.filter(ofType), files);
  const excluded = new Set(pathMatches.filter((m) => m.output === 'none').flatMap((m) => m.files));
  return {
    pathMatches,
    excluded: [...excluded],
    remaining: files.filter((f) => !excluded.has(f)),
    // Path rules come first so final.rules lists them before plain-language ones.
    contributions: [...pathMatches, ...plainMatches.filter(ofType).map((r) => toContribution(r, config))],
  };
}

function toJudgeEntry(r: Rule, config: Pick<Config, 'defaults'>): ToJudge {
  const { rule, diagram, output, context } = toContribution(r, config);
  return { rule, diagram, when: r.when as string, output, ...(context && { context }) };
}

const entryKey = (t: ToJudge) => JSON.stringify([t.rule, t.diagram, t.when, t.output, t.context]);

// The skill lists the built-ins as they are with no config; flows always/request or other defaults must still reach the agent.
const BUILTIN_TO_JUDGE = new Set(
  builtinRules(BUILTIN_DEFAULTS.flows)
    .filter((r) => r.when !== undefined)
    .map((r) => entryKey(toJudgeEntry(r, { defaults: BUILTIN_DEFAULTS }))),
);

/** True when the plain-language rules are exactly the built-ins the skill already states. */
export function onlyBuiltinsToJudge(toJudge: ToJudge[]): boolean {
  return toJudge.length === BUILTIN_TO_JUDGE.size && toJudge.every((t) => BUILTIN_TO_JUDGE.has(entryKey(t)));
}

export function resolveRules(
  config: Config,
  files: string[],
  matched?: string[],
  root = process.cwd(),
): CheckResult {
  const normalized = [...new Set(files.map((f) => normalizePath(f, root)))];
  const { rules: plainMatches, unknown } = findPlainRules(config, matched ?? []);
  const map = resolveDiagram(config, 'map', normalized, plainMatches);
  const flow = resolveDiagram(config, 'flow', normalized, plainMatches);
  const toJudge = config.rules
    .filter((r) => r.when !== undefined)
    .map((r) => toJudgeEntry(r, config));
  const result: CheckResult = {
    pathMatches: [...map.pathMatches, ...flow.pathMatches],
    excludedFiles: { map: map.excluded, flow: flow.excluded },
    remainingFiles: { map: map.remaining, flow: flow.remaining },
    toJudge,
  };
  if (unknown.length > 0) result.unknownMatched = unknown;
  else if (matched !== undefined || toJudge.length === 0) {
    result.final = { map: buildMapFinal(config, map.contributions), flow: buildFlowFinal(flow.contributions) };
  }
  return result;
}
