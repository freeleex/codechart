import { z } from 'zod';

const lineSchema = z.object({ kind: z.enum(['add', 'del', 'ctx', 'hunk']), n: z.number().optional(), text: z.string() });

const nodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  path: z.string().optional(),
  rev: z.string().optional(),
  lines: z.array(lineSchema).optional(),
  note: z.string().optional(),
});

const noteSchema = z.object({
  id: z.string(),
  node: z.string(),
  rev: z.string().optional(),
  anchor: z.object({ path: z.string(), side: z.enum(['old', 'new']), line: z.number(), text: z.string() }).optional(),
  kind: z.enum(['comment', 'question', 'delete']),
  body: z.string(),
  state: z.enum(['pending', 'sent', 'outdated']),
  at: z.string(),
});

const rangeSchema = z.object({ worktree: z.boolean(), head: z.string().optional(), dirty: z.string().optional() });

export const reviewSchema = z.object({
  version: z.literal(1),
  change: z.object({
    slug: z.string(),
    title: z.string().optional(),
    kind: z.enum(['map', 'flow']),
    branch: z.string(),
    html: z.string().optional(),
    renderedAt: z.string(),
    range: rangeSchema.optional(),
  }),
  nodes: z.array(nodeSchema),
  notes: z.array(noteSchema),
});

export type Review = z.infer<typeof reviewSchema>;
export type ReviewNode = z.infer<typeof nodeSchema>;
export type Note = z.infer<typeof noteSchema>;
export type NoteKind = Note['kind'];
export type Range = z.infer<typeof rangeSchema>;
export type DiffLine = z.infer<typeof lineSchema>;
