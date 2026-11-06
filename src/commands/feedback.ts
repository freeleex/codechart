import { Command } from 'commander';
import type { CommandOptions } from '../program.js';
import { feedbackText, osc52 } from '../review/feedback.js';
import { writeReview } from '../review/store.js';
import { guarded, locateChange } from './review-shared.js';

function feedback(o: { take?: boolean; copy?: boolean; change?: string }, opts: CommandOptions): void {
  const { file, review } = locateChange(opts, o.change);
  const text = feedbackText(review);
  if (text === undefined) return opts.stdout('No pending review notes.\n');
  opts.stdout(text);
  if (o.copy && (opts.isTTY ?? process.stderr.isTTY === true)) (opts.rawStderr ?? opts.stderr)(osc52(text));
  if (o.take) writeReview(file, { ...review, notes: review.notes.map((n) => (n.state === 'pending' ? { ...n, state: 'sent' as const } : n)) });
}

export function feedbackCommand(opts: CommandOptions): Command {
  return new Command('feedback')
    .description('print the pending review notes of the latest map as markdown')
    .option('--take', 'mark the printed notes as sent, so the next run skips them')
    .option('--copy', 'also copy the text to the clipboard (terminals with OSC 52)')
    .option('--change <title>', 'the map with this title (or file name slug), instead of the newest one on this branch')
    .action((o: { take?: boolean; copy?: boolean; change?: string }) => guarded(opts, () => feedback(o, opts)));
}
