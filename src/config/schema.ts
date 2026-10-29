import { z } from 'zod';
import { oneLine } from '../spec/shared.js';

export const OUTPUTS = ['auto', 'cli', 'web', 'both', 'none'] as const;
export const CONTEXT_MODES = ['short', 'full'] as const;
export const THEMES = ['auto', 'light', 'dark'] as const;
export const DIAGRAMS = ['map', 'flow'] as const;
export const FLOWS = ['auto', 'always', 'request'] as const;

export type Output = (typeof OUTPUTS)[number];
export type ContextMode = (typeof CONTEXT_MODES)[number];
export type Theme = (typeof THEMES)[number];
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

export interface Config {
  defaults: { output: Output; context: ContextMode; flows: Flows; terminalMaxNodes: number };
  web: { outDir: string; theme: Theme; minNodes: number; keep: number; maxAgeDays: number };
  useBuiltinRules: boolean;
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
    })
    .optional(),
  useBuiltinRules: z.boolean().optional(),
  rules: z.array(ruleSchema).optional(),
});

export type ConfigFile = z.infer<typeof configFileSchema>;

export function configJsonSchema(): object {
  return z.toJSONSchema(configFileSchema, { io: 'input' });
}

function formatPath(path: PropertyKey[]): string {
  if (path.length === 0) return '$';
  return path.reduce<string>((acc, seg) => {
    if (typeof seg === 'number') return `${acc}[${seg}]`;
    const s = String(seg);
    return acc ? `${acc}.${s}` : s;
  }, '');
}

export function parseConfigFile(input: unknown): { ok: true; config: ConfigFile } | { ok: false; errors: string[] } {
  const result = configFileSchema.safeParse(input ?? {});
  if (result.success) return { ok: true, config: result.data };
  return {
    ok: false,
    errors: result.error.issues.map(
      (i) => `${formatPath(i.path)}: ${oneLine(i.message)}`,
    ),
  };
}
