import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { latestRecord } from '../../src/commands/hook-record.js';
import { type Context, createHandlers } from '../../src/opencode/handlers.js';
import server from '../../src/opencode/server.js';
import type { Message } from '../../src/opencode/turn.js';
import { makeSandbox, removeSandbox, repoFromTemplate, type Sandbox } from '../helpers/sandbox.js';

let sb: Sandbox;

beforeEach(() => {
  sb = makeSandbox('ochandlers', { repo: 'repo' });
  repoFromTemplate(sb.repo);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  removeSandbox(sb.tmp);
});

const SID = 'ses_abc123';
const turnsDir = () => join(sb.home, '.cache', 'codechart', 'turns');
const record = () => latestRecord(turnsDir(), sb.repo);
const edit = (...names: string[]) => names.forEach((n) => writeFileSync(join(sb.repo, n), `${n}${Math.random()}\n`));

const user = (id = 'msg_1'): Message => ({ id, type: 'user', text: 'go' });
const text = (t: string) => ({ type: 'text', text: t });
const tool = (command: string) => ({ type: 'tool', state: { input: { command } } });
const assistant = (content: object[] = [text('done')], providerID = 'anthropic'): Message => ({ type: 'assistant', model: { providerID }, content });
const idle = (outcome = 'succeeded'): Message => ({ type: 'idle', outcome });

interface Setup {
  session?: Partial<Awaited<ReturnType<Context['session']['get']>>>;
  messages?: Message[];
}

function setup(o: Setup = {}) {
  const state = { messages: o.messages ?? [user(), assistant(), idle()] };
  const synthetic = vi.fn(async () => ({}));
  const ctx: Context = {
    location: { directory: sb.repo },
    session: {
      get: vi.fn(async () => ({ location: { directory: sb.repo }, outcome: 'succeeded', ...o.session })),
      context: vi.fn(async () => state.messages),
      synthetic,
      hook: vi.fn(async () => ({ dispose: async () => {} })),
    },
    event: { subscribe: vi.fn(() => (async function* () {})()) },
  };
  const handlers = createHandlers(ctx, { home: sb.home, now: () => new Date('2026-11-05T10:00:00Z') });
  return { ctx, state, synthetic, handlers };
}

describe('prompt', () => {
  it('snapshots the dirty files and logs a pending turn for OpenCode', async () => {
    const { handlers } = setup();
    await handlers.onPrompt(SID);
    expect(JSON.parse(readFileSync(join(turnsDir(), `${SID}.json`), 'utf8')).root).toBe(sb.repo);
    expect(record()).toMatchObject({ session: SID, agent: 'opencode', pendingAt: '2026-11-05T10:00:00.000Z' });
  });

  it('is safe to repeat, and ignores a session outside a repo or with an odd id', async () => {
    const { handlers, ctx } = setup();
    await handlers.onPrompt(SID);
    await handlers.onPrompt(SID);
    await handlers.onPrompt('../evil');
    expect(ctx.session.get).toHaveBeenCalledTimes(2);
    const outside = setup({ session: { location: { directory: sb.tmp } } });
    await outside.handlers.onPrompt('ses_other');
    expect(latestRecord(turnsDir(), sb.tmp)).toBeUndefined();
  });

  it('uses the session subpath for the repo lookup', async () => {
    mkdirSync(join(sb.repo, 'pkg'));
    const { handlers } = setup({ session: { location: { directory: sb.tmp }, subpath: 'repo/pkg' } });
    await handlers.onPrompt(SID);
    expect(record()?.root).toBe(sb.repo);
  });
});

describe('idle', () => {
  const turn = async (o: Setup = {}, files = ['a.ts', 'b.ts', 'c.ts']) => {
    const s = setup(o);
    await s.handlers.onPrompt(SID);
    edit(...files);
    await s.handlers.onIdle(SID);
    return s;
  };

  it('3+ changed files and no map: one nudge without file names, logged as nudged', async () => {
    const { synthetic } = await turn();
    expect(synthetic).toHaveBeenCalledTimes(1);
    const call = (synthetic.mock.calls as unknown as [{ sessionID: string; text: string; metadata: object; resume: boolean }][])[0]![0];
    expect(call).toMatchObject({ sessionID: SID, metadata: { codechart: 'nudge' } });
    expect(call.text).toBe(
      'This turn changed 3 files and your reply has no codechart diagram. Unless the user said no diagram, follow the codechart skill now (check, then render) and reply with what it prints; if it says no diagram applies, stop without mentioning it.',
    );
    expect(record()).toMatchObject({ decision: 'nudged', files: ['a.ts', 'b.ts', 'c.ts'], agent: 'opencode', cli: false });
  });

  it('fewer than 3 files: no nudge, logged as few-files', async () => {
    const { synthetic } = await turn({}, ['a.ts', 'b.ts']);
    expect(synthetic).not.toHaveBeenCalled();
    expect(record()).toMatchObject({ decision: 'few-files', files: ['a.ts', 'b.ts'] });
  });

  it('only once per user message, however often the session goes idle', async () => {
    const { handlers, synthetic, state } = await turn();
    await handlers.onIdle(SID);
    state.messages = [user(), assistant(), { type: 'synthetic', text: 'x', metadata: { codechart: 'nudge' } }, assistant(), idle()];
    await handlers.onIdle(SID);
    expect(synthetic).toHaveBeenCalledTimes(1);
  });

  it('a new user message gets its own nudge', async () => {
    const { handlers, synthetic, state } = await turn();
    await handlers.onPrompt(SID);
    edit('d.ts', 'e.ts', 'f.ts');
    state.messages = [user('msg_1'), assistant(), user('msg_2'), assistant(), idle()];
    await handlers.onIdle(SID);
    expect(synthetic).toHaveBeenCalledTimes(2);
  });

  it('a turn that already has our nudge is skipped even after a restart', async () => {
    const own: Message[] = [user(), assistant(), { type: 'synthetic', text: 'x', metadata: { codechart: 'nudge' } }, assistant(), idle()];
    const { synthetic } = await turn({ messages: own });
    expect(synthetic).not.toHaveBeenCalled();
    expect(record()?.decision).toBeUndefined();
  });

  it('a synthetic message that is not ours does not count as a nudge', async () => {
    const { synthetic } = await turn({ messages: [user(), { type: 'synthetic', text: 'x' }, assistant(), idle()] });
    expect(synthetic).toHaveBeenCalledTimes(1);
  });

  it('skips failed and interrupted turns, from the session or its idle marker', async () => {
    for (const o of [{ session: { outcome: 'failed' }, messages: [user(), assistant()] }, { session: { outcome: undefined }, messages: [user(), assistant(), idle('interrupted')] }, { session: { outcome: undefined }, messages: [user(), assistant()] }]) {
      expect((await turn(o)).synthetic).not.toHaveBeenCalled();
    }
  });

  it('the idle marker of the turn wins over a stale session outcome', async () => {
    const { synthetic } = await turn({ session: { outcome: 'failed' }, messages: [user(), assistant(), idle('succeeded')] });
    expect(synthetic).toHaveBeenCalledTimes(1);
  });

  it('skips child sessions', async () => {
    expect((await turn({ session: { parentID: 'ses_parent' } })).synthetic).not.toHaveBeenCalled();
  });

  it('skips claude-code sessions, by session model or by the last reply', async () => {
    expect((await turn({ session: { model: { providerID: 'claude-code' } } })).synthetic).not.toHaveBeenCalled();
    expect((await turn({ messages: [user(), assistant([text('done')], 'claude-code'), idle()] })).synthetic).not.toHaveBeenCalled();
    expect((await turn({ session: { model: { providerID: 'anthropic' } }, messages: [user(), assistant([text('done')], 'claude-code'), idle()] })).synthetic).toHaveBeenCalled();
  });

  it('skips sessions of another location', async () => {
    const other = await turn({ session: { location: { directory: sb.tmp } } });
    expect(other.synthetic).not.toHaveBeenCalled();
    const workspace = await turn({ session: { location: { directory: sb.repo, workspaceID: 'wrk_1' } } });
    expect(workspace.synthetic).not.toHaveBeenCalled();
  });

  it('a map or flow in the reply: no nudge', async () => {
    for (const marker of ['**Map**', '**Flow**']) {
      const { synthetic } = await turn({ messages: [user(), assistant([text(`${marker}\n\n\`\`\``)]), idle()] });
      expect(synthetic).not.toHaveBeenCalled();
      expect(record()?.decision).toBe('diagram-in-reply');
    }
  });

  it('a map in an earlier message of the turn, or codechart run by a tool or shell message: no nudge, logged as used', async () => {
    const earlier = await turn({ messages: [user(), assistant([text('**Map**')]), assistant([text('Done.')]), idle()] });
    expect(earlier.synthetic).not.toHaveBeenCalled();
    expect(record()?.decision).toBe('codechart-used');
    for (const messages of [
      [user(), assistant([tool('codechart check --git')]), assistant(), idle()],
      [user(), assistant([tool('cd x && codechart render --git')]), assistant(), idle()],
      [user(), { type: 'shell', command: 'codechart check' }, assistant(), idle()],
    ]) {
      const { synthetic } = await turn({ messages });
      expect(synthetic).not.toHaveBeenCalled();
      expect(record()).toMatchObject({ decision: 'codechart-used', cli: true });
    }
  });

  it('other commands and a map from an earlier turn do not count', async () => {
    const { synthetic } = await turn({ messages: [user('m0'), assistant([text('**Map**'), tool('codechart check')]), user('m1'), assistant([tool('ls codechart'), tool('echo codechart-check')]), idle()] });
    expect(synthetic).toHaveBeenCalledTimes(1);
  });

  it('no snapshot (the prompt hook never ran): logged, never nudged', async () => {
    const s = setup();
    edit('a.ts', 'b.ts', 'c.ts');
    await s.handlers.onIdle(SID);
    expect(s.synthetic).not.toHaveBeenCalled();
    expect(record()?.decision).toBe('no-snapshot');
  });

  it('two idle events at once nudge once', async () => {
    const s = setup();
    await s.handlers.onPrompt(SID);
    edit('a.ts', 'b.ts', 'c.ts');
    await Promise.all([s.handlers.onIdle(SID), s.handlers.onIdle(SID)]);
    expect(s.synthetic).toHaveBeenCalledTimes(1);
  });

  it('a session with no user message, or an odd id, is ignored', async () => {
    expect((await turn({ messages: [assistant(), idle()] })).synthetic).not.toHaveBeenCalled();
    const s = setup();
    await s.handlers.onIdle('../evil');
    expect(s.ctx.session.get).not.toHaveBeenCalled();
  });

  it('never throws; with CODECHART_DEBUG it says why', async () => {
    const s = setup();
    (s.ctx.session.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(s.handlers.onIdle(SID)).resolves.toBeUndefined();
    expect(err).not.toHaveBeenCalled();
    const loud = createHandlers(s.ctx, { home: sb.home, debug: true });
    await expect(loud.onIdle(SID)).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledWith('codechart: opencode idle: boom');
  });

  it('a failing nudge is not retried and does not throw', async () => {
    const s = setup();
    s.synthetic.mockRejectedValue(new Error('no'));
    await s.handlers.onPrompt(SID);
    edit('a.ts', 'b.ts', 'c.ts');
    await s.handlers.onIdle(SID);
    await s.handlers.onIdle(SID);
    expect(s.synthetic).toHaveBeenCalledTimes(1);
  });
});

describe('plugin', () => {
  it('has the id and registers the prompt hook and an idle subscription, both undone by the cleanup', async () => {
    vi.stubEnv('HOME', sb.home);
    vi.stubEnv('USERPROFILE', sb.home);
    const { ctx } = setup();
    const dispose = vi.fn(async () => {});
    (ctx.session.hook as ReturnType<typeof vi.fn>).mockResolvedValue({ dispose });
    let signal: AbortSignal | undefined;
    (ctx.event.subscribe as ReturnType<typeof vi.fn>).mockImplementation((o: { types: string[]; signal: AbortSignal }) => {
      signal = o.signal;
      expect(o.types).toEqual(['session.idle']);
      return (async function* () {
        yield { data: { sessionID: SID } };
      })();
    });
    expect(server.id).toBe('codechart');
    const cleanup = await server.setup(ctx);
    expect(ctx.session.hook).toHaveBeenCalledWith('prompt', expect.any(Function));
    await cleanup();
    expect(signal?.aborted).toBe(true);
    expect(dispose).toHaveBeenCalled();
  });

  it('survives a hook that fails to register', async () => {
    const { ctx } = setup();
    (ctx.session.hook as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no hooks'));
    const cleanup = await server.setup(ctx);
    await expect(cleanup()).resolves.toBeUndefined();
  });
});
