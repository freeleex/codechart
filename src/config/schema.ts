import { isAbsolute, win32 } from 'node:path';
import { z } from 'zod';
import { formatIssues } from '../spec/shared.js';

const OUTPUTS = ['auto', 'cli', 'web', 'both', 'none'] as const;
const CONTEXT_MODES = ['short', 'full'] as const;
export const THEMES = ['auto', 'light', 'dark'] as const;
const OPEN_MODES = ['auto', 'always', 'never'] as const;
const DIAGRAMS = ['map', 'flow'] as const;
const FLOWS = ['auto', 'always', 'request'] as const;

export type Output = (typeof OUTPUTS)[number];
export type ContextMode = (typeof CONTEXT_MODES)[number];
export type Theme = (typeof THEMES)[number];
type OpenMode = (typeof OPEN_MODES)[number];
export type Diagram = (typeof DIAGRAMS)[number];
export type Flows = (typeof FLOWS)[number];

export interface Rule {
  name: string;
  diagram?: Diagram;
  paths?: string[];
  when?: string;
  output?: Output;
  context?: ContextMode;
}

const RELEASE_AUTO = ['suggest', 'draw', 'off'] as const;
type ReleaseAuto = (typeof RELEASE_AUTO)[number];
export const DEFAULT_RELEASE_BRANCHES = ['v[0-9]*', 'release-*', 'release/*'];

/** The cover of a release map, the browser that prints its PDF, and which branches are release branches. */
interface ReleaseConfig {
  product?: string;
  logo?: string;
  browser?: string;
  branches: string[];
  auto: ReleaseAuto;
}

export interface Config {
  defaults: { output: Output; context: ContextMode; flows: Flows; terminalMaxNodes: number };
  web: { outDir: string; theme: Theme; minNodes: number; keep: number; maxAgeDays: number; open: OpenMode };
  useBuiltinRules: boolean;
  /** Look up the newest codechart once a day and say when there is one. */
  updateCheck: boolean;
  release: ReleaseConfig;
  rules: Rule[];
}

const RULE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Control, line-break, bidi and invisible characters; U+200D stays for emoji.
const ONE_LINE_VISIBLE = /^[^\u0000-\u001f\u007f-\u009f\u200b\u200c\u200e\u200f\u2028-\u202e\u2060-\u2069\ufeff]*$/;
const CHARS_MESSAGE = 'must be one line without control or invisible characters';

// Many wildcards or groups in one segment make picomatch backtrack for minutes.
const glob = z
  .string()
  .min(1)
  .max(200)
  .regex(ONE_LINE_VISIBLE, CHARS_MESSAGE)
  .refine((g) => !/[{(]/.test(g.replace(/\\./g, '')), { message: "braces and extglobs aren't supported; list each pattern separately" })
  .refine((g) => g.split('/').every((seg) => (seg.match(/[*?]/g) ?? []).length <= 8), {
    message: 'at most 8 of * ? per path segment',
  });

const ruleSchema = z
  .strictObject({
    name: z.string().regex(RULE_NAME, 'use 1-64 lowercase letters, digits or hyphens, not starting with a hyphen'),
    diagram: z.enum(DIAGRAMS).optional(),
    paths: z.array(glob).min(1).optional(),
    when: z.string().min(1).max(300).regex(ONE_LINE_VISIBLE, CHARS_MESSAGE).optional(),
    output: z.enum(OUTPUTS).optional(),
    context: z.enum(CONTEXT_MODES).optional(),
  })
  .refine((r) => (r.paths === undefined) !== (r.when === undefined), {
    message: 'set exactly one of paths or when',
  })
  .refine((r) => r.diagram !== 'flow' || r.context === undefined, {
    message: 'context applies only to map rules',
  });

const configFileSchema = z.strictObject({
  defaults: z
    .strictObject({
      output: z.enum(OUTPUTS).optional(),
      context: z.enum(CONTEXT_MODES).optional(),
      flows: z.enum(FLOWS).optional(),
      terminalMaxNodes: z.number().int().positive().optional(),
    })
    .optional(),
  web: z
    .strictObject({
      outDir: z.string().min(1).optional(),
      theme: z.enum(THEMES).optional(),
      minNodes: z.number().int().positive().optional(),
      keep: z.number().int().positive().optional(),
      maxAgeDays: z.number().nonnegative().optional(),
      open: z.enum(OPEN_MODES).optional(),
    })
    .optional(),
  release: z
    .strictObject({
      product: z.string().min(1).max(80).regex(ONE_LINE_VISIBLE, CHARS_MESSAGE).optional().describe('Product name on the cover of a release map (default: the repo name)'),
      logo: z.string().min(1).max(300).regex(ONE_LINE_VISIBLE, CHARS_MESSAGE).optional().describe('Repo-relative path to an .svg or .png of at most 200 KB, shown on the cover of a release map'),
      browser: z.string().min(1).max(300).regex(ONE_LINE_VISIBLE, CHARS_MESSAGE).refine((p) => isAbsolute(p) || win32.isAbsolute(p), 'must be an absolute path').optional().describe('Global only: absolute path of the Chromium-based browser that prints a release map to PDF (default: Chrome, Chromium, Edge or Brave where they are usually installed)'),
      branches: z.array(glob).min(1).optional().describe('Branches that are release branches, as globs (default: v[0-9]*, release-*, release/*)'),
      auto: z.enum(RELEASE_AUTO).optional().describe('On a release branch: suggest a release map, draw one, or do nothing (default: suggest)'),
    })
    .optional(),
  useBuiltinRules: z.boolean().optional(),
  updateCheck: z.boolean().optional().describe('Global only: look up the newest codechart on npm at most once a day and say when there is one (default true)'),
  rules: z.array(ruleSchema).optional(),
});

export type ConfigFile = z.infer<typeof configFileSchema>;

export function configJsonSchema(): object {
  return z.toJSONSchema(configFileSchema, { io: 'input' });
}

export function parseConfigFile(input: unknown): { ok: true; config: ConfigFile } | { ok: false; errors: string[] } {
  const result = configFileSchema.safeParse(input ?? {});
  if (result.success) return { ok: true, config: result.data };
  return { ok: false, errors: formatIssues(result.error) };
}
