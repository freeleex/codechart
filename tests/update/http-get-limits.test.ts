import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ request: undefined as unknown, respond: undefined as unknown }));

vi.mock('node:https', () => ({
  default: {
    get: (_url: string, _opts: unknown, onResponse: (res: unknown) => void) => {
      (fake.respond as (cb: typeof onResponse) => void)(onResponse);
      return fake.request;
    },
  },
}));

const { httpsFetch } = await import('../../src/update/http-get.js');

class Request extends EventEmitter {
  destroyed = false;
  destroy(err?: Error) {
    this.destroyed = true;
    if (err) queueMicrotask(() => this.emit('error', err));
    return this;
  }
}

describe('httpsFetch destroys the request', () => {
  let req: Request;
  let res: EventEmitter & { statusCode?: number };

  beforeEach(() => {
    req = new Request();
    res = Object.assign(new EventEmitter(), { statusCode: 200 });
    fake.request = req;
    fake.respond = (cb: (r: unknown) => void) => queueMicrotask(() => cb(res));
  });

  it('on a body over 256 KB, and rejects', async () => {
    const pending = httpsFetch('https://example.test/');
    await Promise.resolve();
    await Promise.resolve();
    res.emit('data', Buffer.alloc(200 * 1024));
    expect(req.destroyed).toBe(false);
    res.emit('data', Buffer.alloc(100 * 1024));
    expect(req.destroyed).toBe(true);
    await expect(pending).rejects.toThrow('too large');
  });

  it('when the signal fires, even mid-body', async () => {
    const abort = new AbortController();
    const pending = httpsFetch('https://example.test/', { signal: abort.signal });
    await Promise.resolve();
    await Promise.resolve();
    res.emit('data', Buffer.from('{"vers'));
    abort.abort(new Error('timed out'));
    expect(req.destroyed).toBe(true);
    await expect(pending).rejects.toThrow('timed out');
  });

  it('and returns a normal Response for a small body', async () => {
    const pending = httpsFetch('https://example.test/');
    await Promise.resolve();
    await Promise.resolve();
    res.emit('data', Buffer.from('{"version":"1.2.3"}'));
    res.emit('end');
    const out = await pending;
    expect(out.ok).toBe(true);
    expect(await out.json()).toEqual({ version: '1.2.3' });
    expect(req.destroyed).toBe(false);
  });

  it('rejects a status outside 200-599 instead of throwing inside the end handler', async () => {
    res.statusCode = 999;
    const pending = httpsFetch('https://example.test/');
    await Promise.resolve();
    await Promise.resolve();
    res.emit('data', Buffer.from('x'));
    expect(() => res.emit('end')).not.toThrow();
    await expect(pending).rejects.toThrow('status 999');
  });
});
