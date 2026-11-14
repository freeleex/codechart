import https from 'node:https';

const MAX_BYTES = 256 * 1024;
const EMPTY = new Set([204, 205, 304]);

/**
 * A fetch over node:https for the update check. Unlike the global fetch, an aborted signal or a body over the cap
 * destroys the request, so a connect or TLS handshake that never finishes can't keep the process alive.
 */
export const httpsFetch = ((input: string | URL, init?: RequestInit) =>
  new Promise<Response>((resolve, reject) => {
    const signal = init?.signal;
    const req = https.get(String(input), { headers: init?.headers as Record<string, string> | undefined }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) return stop(new Error('response too large'));
        chunks.push(chunk);
      });
      res.on('end', () => {
        const status = res.statusCode ?? 502;
        if (status < 200 || status > 599) return reject(new Error(`status ${status}`));
        resolve(new Response(EMPTY.has(status) ? null : Buffer.concat(chunks), { status }));
      });
      res.on('error', reject);
    });
    function stop(reason: unknown): void {
      req.destroy();
      reject(reason);
    }
    req.on('error', reject);
    if (signal?.aborted) stop(signal.reason);
    else signal?.addEventListener('abort', () => stop(signal.reason), { once: true });
  })) as typeof fetch;
