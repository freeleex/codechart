import { CODECHART_RUN, DIAGRAM } from '../commands/transcript.js';

type Block = { type?: string; text?: string; state?: { input?: { command?: unknown } } };

/** The parts of an OpenCode session message the plugin reads. */
export interface Message {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  outcome?: string;
  metadata?: Record<string, unknown>;
  model?: { providerID?: string };
  content?: Block[];
}

export interface TurnView {
  /** The user message the turn answers. */
  userID: string;
  /** The turn already got a codechart nudge. */
  nudged: boolean;
  /** Text of the agent's last message in the turn. */
  reply?: string;
  diagram: boolean;
  cli: boolean;
  /** How the turn ended, from the session's last idle marker. */
  outcome?: string;
  /** Provider of the agent's last message. */
  providerID?: string;
}

const runsCodechart = (command: unknown) => typeof command === 'string' && CODECHART_RUN.test(command);
const textOf = (m: Message) => (m.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '');

/** What the agent did since the last user message; undefined when there is none. */
export function viewTurn(messages: readonly Message[]): TurnView | undefined {
  const at = messages.map((m) => m.type).lastIndexOf('user');
  const user = messages[at];
  if (!user?.id) return undefined;
  const turn = messages.slice(at + 1);
  const assistants = turn.filter((m) => m.type === 'assistant');
  const texts = assistants.flatMap(textOf);
  const lastReply = assistants.at(-1);
  return {
    userID: user.id,
    nudged: turn.some((m) => m.type === 'synthetic' && m.metadata?.codechart !== undefined),
    reply: lastReply && textOf(lastReply).join('\n'),
    diagram: texts.some((t) => DIAGRAM.test(t)),
    cli:
      turn.some((m) => m.type === 'shell' && runsCodechart(m.command)) ||
      assistants.some((m) => (m.content ?? []).some((b) => b.type === 'tool' && runsCodechart(b.state?.input?.command))),
    outcome: turn.filter((m) => m.type === 'idle').at(-1)?.outcome,
    providerID: assistants.at(-1)?.model?.providerID,
  };
}
