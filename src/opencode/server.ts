import { type Context, createHandlers } from './handlers.js';

async function setup(ctx: Context): Promise<() => Promise<void>> {
  const abort = new AbortController();
  const handlers = createHandlers(ctx, { debug: Boolean(process.env.CODECHART_DEBUG) });
  let registration: { dispose: () => Promise<void> } | undefined;
  try {
    registration = await ctx.session.hook('prompt', (event) => handlers.onPrompt(event.sessionID).catch((e) => handlers.fail('prompt', e)));
    void (async () => {
      for await (const event of ctx.event.subscribe({ types: ['session.idle'], signal: abort.signal })) {
        if (event.data?.sessionID) void handlers.onIdle(event.data.sessionID);
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
