import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { readRegularFile } from '../read-regular.js';

// User-level skills folders from each agent's docs (2026-10). `reads` lists other folders the agent also loads skills from.
export interface AgentPreset {
  name: string;
  label: string;
  home: string;
  skills: string;
  reads: string[];
  /** The user-level instructions file the agent loads every session. */
  instructions?: string;
}

const SHARED = '.agents/skills';

export const AGENTS: AgentPreset[] = [
  { name: 'claude', label: 'Claude Code', home: '.claude', skills: '.claude/skills', reads: [], instructions: '.claude/CLAUDE.md' },
  { name: 'codex', label: 'Codex', home: '.codex', skills: SHARED, reads: [], instructions: '.codex/AGENTS.md' },
  { name: 'gemini', label: 'Gemini CLI', home: '.gemini', skills: '.gemini/skills', reads: [SHARED], instructions: '.gemini/GEMINI.md' },
  { name: 'copilot', label: 'GitHub Copilot', home: '.copilot', skills: '.copilot/skills', reads: [SHARED] },
  { name: 'cursor', label: 'Cursor', home: '.cursor', skills: '.cursor/skills', reads: [SHARED, '.claude/skills', '.codex/skills'] },
  { name: 'opencode', label: 'OpenCode', home: '.config/opencode', skills: '.config/opencode/skills', reads: [SHARED, '.claude/skills'], instructions: '.config/opencode/AGENTS.md' },
  { name: 'goose', label: 'Goose', home: '.config/goose', skills: SHARED, reads: ['.claude/skills'] },
  { name: 'amp', label: 'Amp', home: '.config/amp', skills: '.config/agents/skills', reads: ['.claude/skills'] },
  { name: 'windsurf', label: 'Windsurf', home: '.codeium/windsurf', skills: '.codeium/windsurf/skills', reads: [SHARED] },
  { name: 'cline', label: 'Cline', home: '.cline', skills: '.cline/skills', reads: [] },
  { name: 'roo', label: 'Roo Code', home: '.roo', skills: '.roo/skills', reads: [SHARED] },
  { name: 'kiro', label: 'Kiro', home: '.kiro', skills: '.kiro/skills', reads: [] },
  { name: 'junie', label: 'Junie', home: '.junie', skills: '.junie/skills', reads: [] },
  { name: 'droid', label: 'Factory Droid', home: '.factory', skills: '.factory/skills', reads: [] },
];

// One folder per agent, unless the agent already loads a folder chosen for an earlier one.
export function skillFolders(agents: AgentPreset[]): { folder: string; agents: AgentPreset[] }[] {
  const groups: { folder: string; agents: AgentPreset[] }[] = [];
  for (const a of agents) {
    const shared = groups.find((g) => [a.skills, ...a.reads].includes(g.folder));
    if (shared) shared.agents.push(a);
    else groups.push({ folder: a.skills, agents: [a] });
  }
  return groups;
}

/** A folder whose SKILL.md is a regular file naming the codechart skill; only such folders are updated or removed. */
export function isCodechartSkill(dir: string): boolean {
  const skill = join(dir, 'SKILL.md');
  const text = lstatSync(skill, { throwIfNoEntry: false })?.isFile() ? readRegularFile(skill, (s) => s.isFile()) : undefined;
  return text !== undefined && /^---\r?\n(?:.*\r?\n)*?name: codechart\r?\n/.test(text);
}
