/*! codechart OpenCode plugin: install-skill copies this file to ~/.config/opencode/plugins/codechart.js */
import { type Context, createHandlers } from './handlers.js';

async function setup(ctx: Context): Promise<() => Promise<void>> {
  const abort = new AbortController();
  const handlers = createHandlers(ctx, { debug: Boolean(process.env.CODECHART_DEBUG) });
  let registration: { dispose: () => Promise<void> } | undefined;
  try {
    registration = await ctx.session.hook('prompt', (event) => handlers.onPrompt(event.sessionID).catch((e) => handlers.fail('prompt', e)));
    void (async () => {
      // OpenCode 2.2 emits session.execution.succeeded; session.idle is the documented name. A turn is judged once either way.
      for await (const event of ctx.event.subscribe({ types: ['session.idle', 'session.execution.succeeded'], signal: abort.signal })) {
        if (event.data?.sessionID) void handlers.onIdle(event.data.sessionID, event.type === 'session.execution.succeeded');
      }
    })().catch((e) => handlers.fail('events', e));
  } catch (e) {
    handlers.fail('setup', e);
  }
  return async () => {
    abort.abort();
    await registration?.dispose().catch(() => {});
  };
}

export default { id: 'codechart', setup };
