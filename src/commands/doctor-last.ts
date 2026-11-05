import { join } from 'node:path';
import { findRepoRoot, loadConfig } from '../config/load.js';
import type { CommandOptions } from '../program.js';
import { resolveRules } from '../rules/resolve.js';
import { latestRecord, turnsDir, type Decision, type TurnRecord } from './hook-record.js';
import { claudeHookEvents } from './nudges.js';

const MIN_FILES = 3;

const WHY: Record<Decision, string> = {
  stop_hook_active: 'the Stop hook had already asked once this turn, so it stayed quiet',
  'no-snapshot': 'no snapshot of the files before the turn (too many changed files, or the prompt hook did not run first), so it could not tell what changed',
  'other-root': "the turn's snapshot was taken in a different repo",
  'few-files': `the turn changed fewer than ${MIN_FILES} files, so the hook did not ask for a diagram`,
  'diagram-in-reply': 'the reply already had a codechart diagram',
  'codechart-used': 'the agent already ran codechart this turn',
  nudged: 'the hook sent the agent back to draw a diagram',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function rulesLines(rec: TurnRecord, root: string, opts: CommandOptions, home: string): string[] {
  const files = rec.files ?? [];
  if (!files.length) return [];
  const config = loadConfig({ cwd: root, home, env: opts.env, warn: () => {} });
  const fired = resolveRules(config, files, undefined, root).pathMatches.filter((m) => m.output !== 'none');
  const lines = fired.map((m) => `rule ${m.rule} fires (${m.diagram}) on ${m.files.slice(0, 3).join(', ')}${m.files.length > 3 ? ', …' : ''}`);
  if (!fired.length) lines.push('no rule fires (e.g. only tests or generated files changed); the built-in rules are judged by the agent');
  if (fired.length && files.length < MIN_FILES) lines.push(`the hook and the rules disagree: a rule fires on ${plural(files.length, 'file')}, but the hook only asks from ${MIN_FILES}`);
  if (!fired.length && rec.decision === 'nudged') lines.push('a nudge here is expected: with no path rule matching, the agent judges related-files and behaviour-flow itself, and may answer that no diagram applies');
  return lines;
}

function hasClaudeHooks(home: string): boolean {
  try {
    return claudeHookEvents(join(home, '.claude', 'settings.json')).ok.length === 2;
  } catch {
    return false;
  }
}

/** Why the last turn in this repo got, or did not get, a diagram. Returns whether it could say. */
export function explainLast(cwd: string, home: string, opts: CommandOptions): boolean {
  const say = (line: string) => opts.stdout(`${line}\n`);
  const root = findRepoRoot(cwd);
  if (!root) {
    opts.stderr('codechart: not in a git repo; run it from the repo where the diagram was missing\n');
    return false;
  }
  if (!hasClaudeHooks(home)) {
    say('The Claude Code hooks are not installed, so no turn was logged. `doctor --last` supports Claude Code only for now.');
    say('Fix: codechart install-skill --agent claude --hook');
    return true;
  }
  const rec = latestRecord(turnsDir(home), root);
  if (!rec) {
    say(`No turn logged for ${root}: the hooks never ran here.`);
    say('Sessions hosted by the Claude Agent SDK sometimes load 0 hooks (anthropics/claude-code#87657). Run `codechart doctor` to check the hooks are installed, then start a new session.');
    return true;
  }
  say(`Last turn: ${rec.at}, session ${rec.session}`);
  if (!rec.decision) {
    say('The prompt hook ran, but the Stop hook left no decision: it did not run (or the turn is still going).');
    return true;
  }
  if (rec.pendingAt) say(`A newer prompt (${rec.pendingAt}) has no Stop decision yet: it is the current turn, or the Stop hook did not run for it. Showing the turn before it.`);
  if (rec.quietAt) say(`A later turn (${rec.quietAt}) changed no files, so there was nothing to map. Showing the last turn that did.`);
  say(`Decision: ${rec.decision}: ${WHY[rec.decision]}.`);
  say(`Changed files: ${rec.files?.length ?? 0}${rec.files?.length ? ` (${rec.files.slice(0, 5).join(', ')}${rec.files.length > 5 ? ', …' : ''})` : ''}`);
  for (const line of rulesLines(rec, root, opts, home)) say(line);
  if (rec.skill !== undefined) say(rec.skill ? 'The agent loaded the codechart skill.' : 'The agent did not load the codechart skill this turn.');
  return true;
}
