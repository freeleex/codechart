import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse, parseTree, type ParseError } from 'jsonc-parser';
import { appendItem, nodeAt, removeItem, replaceString } from './jsonc-edit.js';
import { readRegular } from './nudges.js';

const NAME = 'codechart';
const SCHEMA = 'https://opencode.ai/config.json';
// OpenCode V2 reads `plugins`, and the older `plugin` too.
const KEYS = ['plugins', 'plugin'] as const;

type Key = (typeof KEYS)[number];
type Root = Partial<Record<Key, unknown>>;

interface Entry {
  key: Key;
  index: number;
  spec: string;
  /** The `{ package, options }` form, whose options stay. */
  object: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const specOf = (e: unknown): string | undefined => (typeof e === 'string' ? e : isObject(e) && typeof e.package === 'string' ? e.package : undefined);

const isOurs = (spec: string) => spec === NAME || spec.startsWith(`${NAME}@`);

export const pluginSpec = (version: string) => `${NAME}@${version}`;

/** The global OpenCode config: the .jsonc or .json that already names codechart, else the one that exists, else a new opencode.json. */
export function opencodeConfigFile(home: string): string {
  const dir = join(home, '.config', 'opencode');
  const existing = ['opencode.jsonc', 'opencode.json'].map((n) => join(dir, n)).filter((f) => existsSync(f));
  const mine = existing.find((f) => {
    try {
      return pluginSpecs(f).length > 0;
    } catch {
      return false;
    }
  });
  return mine ?? existing[0] ?? join(dir, 'opencode.json');
}

function load(file: string): { path: string; text: string; root: Root } {
  const { path, text = '' } = readRegular(file);
  const errors: ParseError[] = [];
  const root: unknown = text.trim() === '' ? {} : parse(text, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error(`${file}: not valid JSON; add "${NAME}@<version>" to "plugins" by hand`);
  if (!isObject(root)) throw new Error(`${file}: not a JSON object`);
  for (const key of KEYS) if (root[key] !== undefined && !Array.isArray(root[key])) throw new Error(`${file}: "${key}" is not a list`);
  return { path, text, root };
}

const entries = (root: Root): Entry[] =>
  KEYS.flatMap((key) =>
    ((root[key] as unknown[] | undefined) ?? []).flatMap((e, index) => {
      const spec = specOf(e);
      return spec !== undefined && isOurs(spec) ? [{ key, index, spec, object: typeof e !== 'string' }] : [];
    }),
  );

/** The codechart entries of an OpenCode config, such as `codechart@0.4.0`; throws on a file it can't read. */
export function pluginSpecs(file: string): string[] {
  return entries(load(file).root).map((e) => e.spec);
}

const indentUnit = (text: string) => /^([ \t]+)\S/m.exec(text)?.[1] ?? '  ';

/** Pins codechart in the config's plugin list, replacing any other codechart entry (options stay); other settings and comments stay. */
export function pinPlugin(file: string, version: string): 'added' | 'updated' | 'present' {
  const { path, text: before, root } = load(file);
  const spec = pluginSpec(version);
  const [first, ...extra] = entries(root);
  let text = before;
  if (first && first.spec !== spec) text = replaceString(text, first.object ? [first.key, first.index, 'package'] : [first.key, first.index], spec);
  for (const e of [...extra].sort((a, b) => b.index - a.index)) text = removeItem(text, nodeAt(text, [e.key])!, e.index);
  if (!first) {
    const list = nodeAt(text, ['plugins']);
    if (before.trim() === '') text = `${JSON.stringify({ $schema: SCHEMA, plugins: [spec] }, null, 2)}\n`;
    else if (list) text = appendItem(text, list, JSON.stringify(spec), indentUnit(text));
    else text = appendItem(text, parseTree(text, [], { allowTrailingComma: true })!, `"plugins": [${JSON.stringify(spec)}]`, indentUnit(text));
  }
  if (text === before) return 'present';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return first ? 'updated' : 'added';
}

/** Rewrites an existing codechart entry to `version`; none is added. */
export function refreshPlugin(file: string, version: string): 'updated' | 'present' | 'absent' {
  try {
    if (pluginSpecs(file).length === 0) return 'absent';
    return pinPlugin(file, version) === 'present' ? 'present' : 'updated';
  } catch {
    return 'absent';
  }
}

/** Removes every codechart entry; the rest of the file stays. */
export function removePlugin(file: string): 'removed' | 'absent' {
  const { path, text: before, root } = load(file);
  const found = entries(root);
  if (!found.length) return 'absent';
  let text = before;
  for (const e of [...found].sort((a, b) => b.index - a.index)) text = removeItem(text, nodeAt(text, [e.key])!, e.index);
  writeFileSync(path, text);
  return 'removed';
}
