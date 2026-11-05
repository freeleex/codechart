export const DIAGRAM = /\*\*(Map|Flow)\*\*/;

type Entry = { type?: string; isMeta?: boolean; message?: { content?: unknown } };
type Block = { type?: string; text?: string; name?: string; input?: { command?: unknown; skill?: unknown; file_path?: unknown } };

const blocks = (e: Entry): Block[] => (Array.isArray(e.message?.content) ? (e.message.content as Block[]) : []);

/** A prompt the user typed, not a tool result or an injected note. */
const isPrompt = (e: Entry) =>
  e.type === 'user' && !e.isMeta && (typeof e.message?.content === 'string' || (blocks(e).length > 0 && !blocks(e).some((b) => b.type === 'tool_result')));

export const CODECHART_RUN = /\bcodechart\s+(check|render)\b/;
const SKILL_FILE = /[\\/]skills[\\/]codechart[\\/]/;

const showsDiagram = (b: Block) => b.type === 'text' && DIAGRAM.test(b.text ?? '');
const runsCli = (b: Block) => b.type === 'tool_use' && typeof b.input?.command === 'string' && CODECHART_RUN.test(b.input.command);
const loadsSkill = (b: Block) =>
  b.type === 'tool_use' &&
  ((b.name === 'Skill' && typeof b.input?.skill === 'string' && b.input.skill.split(':').pop() === 'codechart') ||
    (typeof b.input?.file_path === 'string' && SKILL_FILE.test(b.input.file_path)));

export interface TurnScan {
  /** A map or flow block in the agent's text. */
  diagram: boolean;
  /** `codechart check` or `render` ran (it may have said no diagram applies). */
  cli: boolean;
  /** The skill was loaded (Skill tool) or its files read. */
  skill: boolean;
}

/** What the agent did since the last prompt. */
export function scanTurn(jsonl: string): TurnScan {
  let scan: TurnScan = { diagram: false, cli: false, skill: false };
  for (const line of jsonl.split('\n')) {
    let e: Entry;
    try {
      e = JSON.parse(line) as Entry;
    } catch {
      continue;
    }
    if (isPrompt(e)) scan = { diagram: false, cli: false, skill: false };
    else if (e.type === 'assistant') {
      const bs = blocks(e);
      scan = { diagram: scan.diagram || bs.some(showsDiagram), cli: scan.cli || bs.some(runsCli), skill: scan.skill || bs.some(loadsSkill) };
    }
  }
  return scan;
}

/** Whether the agent, since the last prompt, showed a diagram or ran codechart (which may have said no diagram applies). */
export function turnUsedCodechart(jsonl: string): boolean {
  const { diagram, cli } = scanTurn(jsonl);
  return diagram || cli;
}
