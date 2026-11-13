import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse } from 'yaml';
import { readRegularFile } from '../read-regular.js';
import { findRepoRoot } from './repo-root.js';
import { builtinRules } from './builtin-rules.js';
import { DEFAULT_RELEASE_BRANCHES, parseConfigFile, type Config, type ConfigFile, type Rule } from './schema.js';

const BUILTIN = 'built-in';
const MAX_BYTES = 1024 * 1024;
export const BUILTIN_DEFAULTS: Readonly<Config['defaults']> = { output: 'auto', context: 'short', flows: 'auto', terminalMaxNodes: 15 };

// A cloned repo must not choose where HTML lands or what gets pruned.
export const GLOBAL_ONLY = ['web.outDir', 'web.keep', 'web.maxAgeDays', 'web.open', 'updateCheck', 'release.browser'] as const;

export { findRepoRoot };

interface LoadOptions {
  cwd: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  warn?: (line: string) => void;
}

/** `root`: the file must resolve inside it (a repo can commit a symlink). */
function readConfigFile(file: string, root?: string): ConfigFile | undefined {
  let real: string;
  try {
    real = realpathSync(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
  if (root !== undefined) {
    const rel = relative(realpathSync(root), real);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`${file}: resolves outside the repo`);
  }
  const text = readRegularFile(real, (st) => {
    if (!st.isFile()) throw new Error(`${file}: not a regular file`);
    if (st.size > MAX_BYTES) throw new Error(`${file}: too large (over 1 MB)`);
    return true;
  })!;
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    throw new Error(`${file}: ${(e as Error).message.split('\n')[0]}`);
  }
  const defaults = (raw as { defaults?: Record<string, unknown> } | null)?.defaults;
  if (typeof defaults === 'object' && defaults !== null && 'icons' in defaults) throw new Error(`${file}: defaults.icons was removed (the map always uses + - ~ · ◆); delete it`);
  const result = parseConfigFile(raw);
  if (!result.ok) throw new Error(result.errors.map((m) => `${file}: ${m}`).join('\n'));
  const seen = new Set<string>();
  (result.config.rules ?? []).forEach((rule, i) => {
    if (seen.has(rule.name)) throw new Error(`${file}: rules[${i}].name: duplicate "${rule.name}"`);
    seen.add(rule.name);
  });
  return result.config;
}

// A cloned repo must not change where pages go, whether codechart goes online or which program it launches.
function dropGlobalOnly(file: ConfigFile | undefined, path: string, warn?: (line: string) => void): ConfigFile | undefined {
  if (!file) return file;
  const { updateCheck, ...rest } = file;
  const { outDir, keep, maxAgeDays, open, ...web } = file.web ?? {};
  const { browser, ...release } = file.release ?? {};
  const ignored = [
    ...Object.entries({ outDir, keep, maxAgeDays, open }).filter(([, v]) => v !== undefined).map(([k]) => `web.${k}`),
    ...(updateCheck === undefined ? [] : ['updateCheck']),
    ...(browser === undefined ? [] : ['release.browser']),
  ];
  if (ignored.length) warn?.(`${path}: ${ignored.join(', ')} ${ignored.length === 1 ? 'is' : 'are'} global-only; ignored`);
  return { ...rest, ...(file.web && { web }), ...(file.release && { release }) };
}

function firstByName<T extends { rule: Rule }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(({ rule }) => !seen.has(rule.name) && seen.add(rule.name));
}

function resolveOutDir(dir: string, home: string): string {
  const expanded = dir === '~' ? home : dir.startsWith('~/') ? join(home, dir.slice(2)) : dir;
  return resolve(home, expanded);
}

const RELEASE_KEYS = ['product', 'logo', 'browser', 'branches', 'auto'] as const;

/** `release.*`: a later file wins, key by key. */
function releaseOf(files: { file?: ConfigFile; source: string }[], sources: Record<string, string>): Config['release'] {
  const release: Config['release'] = { branches: DEFAULT_RELEASE_BRANCHES, auto: 'suggest' };
  sources['release.branches'] = BUILTIN;
  sources['release.auto'] = BUILTIN;
  for (const { file, source } of files) {
    for (const key of RELEASE_KEYS) {
      const value = file?.release?.[key];
      if (value === undefined) continue;
      Object.assign(release, { [key]: value });
      sources[`release.${key}`] = source;
    }
  }
  return release;
}

export interface ConfigWithSources {
  config: Config;
  sources: Record<string, string>;
  ruleSources: string[];
}

function configHome(env: NodeJS.ProcessEnv, home: string): string | undefined {
  const xdg = env.XDG_CONFIG_HOME;
  return xdg && isAbsolute(xdg) ? xdg : home ? join(home, '.config') : undefined;
}

type SourcedFiles = { file?: ConfigFile; source: string }[];

function mergeSections(files: SourcedFiles, sources: Record<string, string>): { defaults: Config['defaults']; web: Config['web'] } {
  const defaults: Config['defaults'] = { ...BUILTIN_DEFAULTS };
  const web: Config['web'] = {
    outDir: '~/.cache/codechart',
    theme: 'auto',
    minNodes: 8,
    keep: 20,
    maxAgeDays: 7,
    open: 'auto',
  };
  for (const key of Object.keys(defaults)) sources[`defaults.${key}`] = BUILTIN;
  for (const key of Object.keys(web)) sources[`web.${key}`] = BUILTIN;
  for (const { file, source } of files) {
    Object.assign(defaults, file?.defaults);
    Object.assign(web, file?.web);
    for (const key of Object.keys(file?.defaults ?? {})) sources[`defaults.${key}`] = source;
    for (const key of Object.keys(file?.web ?? {})) sources[`web.${key}`] = source;
  }
  return { defaults, web };
}

function builtinRulesFlag(global: ConfigFile | undefined, repo: ConfigFile | undefined, files: SourcedFiles, sources: Record<string, string>): boolean {
  const useBuiltinRules = global?.useBuiltinRules !== false && repo?.useBuiltinRules !== false;
  for (const { file, source } of files) {
    if (file?.useBuiltinRules === useBuiltinRules) sources.useBuiltinRules = source;
  }
  return useBuiltinRules;
}

export function loadConfigWithSources(opts: LoadOptions): ConfigWithSources {
  const home = opts.home ?? homedir();
  const configDir = configHome(opts.env ?? process.env, home);

  const root = findRepoRoot(opts.cwd) ?? resolve(opts.cwd);
  const globalPath = configDir ? join(configDir, 'codechart', 'config.yaml') : undefined;
  const repoPath = join(root, '.codechart.yaml');
  const global = globalPath ? readConfigFile(globalPath) : undefined;
  const repo = dropGlobalOnly(readConfigFile(repoPath, root), repoPath, opts.warn);
  const globalSource = `global: ${globalPath}`;
  const repoSource = `repo: ${repoPath}`;
  const files = [
    { file: global, source: globalSource },
    { file: repo, source: repoSource },
  ];

  const sources: Record<string, string> = {};
  const { defaults, web } = mergeSections(files, sources);
  sources.useBuiltinRules = BUILTIN;
  sources.updateCheck = global?.updateCheck === undefined ? BUILTIN : globalSource;
  web.outDir = resolveOutDir(web.outDir, home);

  const useBuiltinRules = builtinRulesFlag(global, repo, files, sources);

  const tagged = firstByName([
    ...(repo?.rules ?? []).map((rule) => ({ rule, source: repoSource })),
    ...(global?.rules ?? []).map((rule) => ({ rule, source: globalSource })),
    ...(useBuiltinRules ? builtinRules(defaults.flows) : []).map((rule) => ({ rule, source: BUILTIN })),
  ]);

  const release = releaseOf(files, sources);
  return {
    config: { defaults, web, useBuiltinRules, updateCheck: global?.updateCheck !== false, release, rules: tagged.map((t) => t.rule) },
    sources,
    ruleSources: tagged.map((t) => t.source),
  };
}

export function loadConfig(opts: LoadOptions): Config {
  return loadConfigWithSources(opts).config;
}
