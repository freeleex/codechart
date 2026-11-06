import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import type { CommandOptions } from '../program.js';
import { colorDoc } from '../review/color.js';
import { buildDoc } from '../review/doc.js';
import { countsLine } from '../review/feedback.js';
import { mergeNotes } from '../review/merge.js';
import { normalizeEol, parseDoc } from '../review/parse.js';
import { isStale } from '../review/snapshot.js';
import { updateReview } from '../review/store.js';
import { defaultEditor, runEditor } from './review-editor.js';
import { guarded, locateChange } from './review-shared.js';

/** Opens `text` in the editor and returns what it was left as; undefined when it was left as it was. The editor failing cancels. */
function edit(file: string, text: string, opts: CommandOptions): string | undefined {
  const env = opts.env ?? process.env;
  const editor = env.VISUAL || env.EDITOR || defaultEditor();
  writeFileSync(file, text, { mode: 0o600 });
  const status = (opts.editor ?? runEditor)(editor, file);
  if (status !== 0) throw new Error(`The editor (${editor}) exited with status ${status}, so nothing was saved.`);
  const after = readFileSync(file, 'utf8');
  return normalizeEol(after) === text ? undefined : after;
}

async function review(o: { change?: string; print?: boolean }, opts: CommandOptions): Promise<void> {
  const { root, review: r } = locateChange(opts, o.change);
  if (isStale(root, r.change.range)) opts.stderr('codechart: The code has changed since this map was drawn. Ask your agent to redraw it to review the latest.\n');
  const doc = buildDoc(r);
  const env = opts.env ?? process.env;
  if (o.print) return opts.stdout((opts.isTTY ?? process.stdout.isTTY === true) && !env.NO_COLOR ? colorDoc(doc) : doc);
  const dir = mkdtempSync(join(tmpdir(), 'codechart-review-'));
  const file = join(dir, `${r.change.slug.replace(/\.flow$/, '').replace(/[^a-z0-9-]/g, '-').slice(0, 40) || 'review'}.diff`);
  let keep = false;
  try {
    const after = edit(file, doc, opts);
    if (after === undefined) return opts.stdout('No changes, nothing saved.\n');
    const parsed = parseDoc(after, r, opts.now?.() ?? new Date());
    for (const w of parsed.warnings) opts.stderr(`codechart: ${w}\n`);
    if (parsed.skipped > 0) {
      keep = true;
      throw new Error(`Some notes could not be read (see above); nothing saved. Your notes are kept in ${file}`);
    }
    // The change may have been re-rendered or read by the agent while the editor was open, and the branch switched:
    // look again on the branch it was opened on, and merge into the file as it is now.
    let saved;
    try {
      const fresh = locateChange(opts, r.change.slug, r.change.branch);
      saved = updateReview(fresh.file, (current) => ({ ...current, notes: mergeNotes(r, parsed.notes, current) }));
    } catch (e) {
      keep = true;
      throw new Error(`${(e as Error).message} Your notes are kept in ${file}`);
    }
    opts.stdout(`✔ ${countsLine(saved)}\nTell your agent "review done" and it will pick up your notes.\n`);
  } finally {
    if (!keep) rmSync(dir, { recursive: true, force: true });
  }
}

export function reviewCommand(opts: CommandOptions): Command {
  return new Command('review')
    .description("write review notes on the latest map in your editor; an agent reads them with 'codechart feedback'")
    .option('--change <title>', 'review the map with this title (or file name slug) instead of the newest one on this branch')
    .option('--print', 'print the review document instead of opening an editor')
    .action((o: { change?: string; print?: boolean }) => guarded(opts, () => review(o, opts)));
}
