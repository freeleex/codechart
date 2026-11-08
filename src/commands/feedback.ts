import { Command, Option } from 'commander';
import type { CommandOptions } from '../program.js';
import { sanitizeText } from '../render/strip.js';
import { readClipboard } from '../review/clipboard.js';
import { changeTitle } from '../review/doc.js';
import { countsLine, feedbackText, osc52 } from '../review/feedback.js';
import { importNotes, MAX_IMPORT_BYTES, parseReviewText } from '../review/import.js';
import { updateReview, type Found, type Which } from '../review/store.js';
import { guarded, locateChange } from './review-shared.js';
import { readStdin } from './stdin.js';

interface FeedbackFlags {
  take?: boolean;
  copy?: boolean;
  change?: string;
  import?: boolean;
}

const TOO_LONG = new Error('The pasted text is too long to be a codechart review (over 512 KB).');

/** The pasted review: piped in when stdin is a pipe, else the clipboard. */
async function pastedText(opts: CommandOptions): Promise<string> {
  const piped = opts.stdin ?? (opts.readClipboard || process.stdin.isTTY ? undefined : () => readStdin(MAX_IMPORT_BYTES, TOO_LONG));
  return piped ? piped() : (opts.readClipboard ?? readClipboard)();
}

/** Adds the pasted notes to their map's review file; returns the file and its review as saved. */
async function importReview(opts: CommandOptions): Promise<Found> {
  const payload = parseReviewText(await pastedText(opts));
  let found;
  try {
    found = locateChange(opts, payload.slug, payload.branch, true, 'all');
  } catch {
    throw new Error(`No map called "${payload.slug}"${payload.branch ? ` on branch ${payload.branch}` : ''}. Render it again, then copy the review again.`);
  }
  const now = opts.now?.() ?? new Date();
  let result: ReturnType<typeof importNotes> | undefined;
  const saved = updateReview(found.file, (current) => {
    result = importNotes(current, payload, now);
    return result.review;
  });
  const { added, outdated } = result!;
  const n = (count: number) => `${count} note${count === 1 ? '' : 's'}`;
  opts.stderr(
    added === 0
      ? 'Nothing new to import: these notes are already saved.\n'
      : sanitizeText(`✔ Imported ${n(added)} into "${changeTitle(saved)}"${outdated ? ` (${outdated} outdated: the map changed since the page was drawn)` : ''}\n`),
  );
  return { file: found.file, review: saved };
}

const hasPending = (f: Found): boolean => f.review.notes.some((n) => n.state === 'pending');

function tryLocate(opts: CommandOptions, which: Which): Found | Error {
  try {
    return locateChange(opts, undefined, undefined, false, which);
  } catch (e) {
    return e as Error;
  }
}

/** The newest map, unless the newest business page holds notes to read and the map holds none or is older. */
function newestChange(opts: CommandOptions): Found {
  const tech = tryLocate(opts, 'tech');
  const business = tryLocate(opts, 'business');
  if (business instanceof Error) {
    if (tech instanceof Error) throw tech;
    return tech;
  }
  if (tech instanceof Error) return business;
  const newer = business.review.change.renderedAt > tech.review.change.renderedAt;
  return hasPending(business) && (!hasPending(tech) || newer) ? business : tech;
}

/** A map or flow with this title; a business page only when none matches. */
function locateTitled(opts: CommandOptions, title: string): Found {
  try {
    return locateChange(opts, title, undefined, false, 'tech');
  } catch (e) {
    try {
      return locateChange(opts, title, undefined, false, 'business');
    } catch {
      throw e;
    }
  }
}

async function feedback(o: FeedbackFlags, opts: CommandOptions): Promise<void> {
  const { file, review } = o.import ? await importReview(opts) : o.change === undefined ? newestChange(opts) : locateTitled(opts, o.change);
  if (o.import && !o.take) return opts.stdout(`${countsLine(review)}\n`);
  let text = feedbackText(review);
  if (o.take) {
    // Taken under the lock from the notes as they are now, so a note added meanwhile is neither lost nor marked sent unprinted.
    updateReview(file, (current) => {
      text = feedbackText(current);
      return text === undefined ? current : { ...current, notes: current.notes.map((n) => (n.state === 'pending' ? { ...n, state: 'sent' as const } : n)) };
    });
  }
  if (text === undefined) return opts.stdout('No pending review notes.\n');
  opts.stdout(text);
  if (o.copy && (opts.isTTY ?? process.stderr.isTTY === true)) (opts.rawStderr ?? opts.stderr)(osc52(text));
}

export function feedbackCommand(opts: CommandOptions): Command {
  return new Command('feedback')
    .description('print the pending review notes of the latest map as markdown; --import first saves the notes copied from the page')
    .option('--take', 'mark the printed notes as sent, so the next run skips them')
    .option('--copy', 'also copy the text to the clipboard (terminals with OSC 52)')
    .addOption(new Option('--change <title>', 'the map with this title (or file name slug), instead of the newest one on this branch').conflicts('import'))
    .option('--import', 'save the review copied from the page ("Finish review") into its map first: read from stdin, else the clipboard')
    .action((o: FeedbackFlags) => guarded(opts, () => feedback(o, opts)));
}
