import { spawn } from 'node:child_process';
import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { httpsFetch } from '../../src/update/http-get.js';

const TIMEOUT = 300;

describe('httpsFetch against a host that accepts the connection and never answers', () => {
  let server: Server;
  let url: string;
  const sockets: Socket[] = [];

  beforeEach(async () => {
    server = createServer((s) => void sockets.push(s));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `https://127.0.0.1:${(server.address() as { port: number }).port}/codechart/latest`;
  });

  afterEach(() => {
    server.close();
    sockets.splice(0).forEach((s) => s.destroy());
  });

  it('rejects soon after the timeout', async () => {
    const started = Date.now();
    await expect(httpsFetch(url, { signal: AbortSignal.timeout(TIMEOUT) })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(TIMEOUT + 200);
  });

  it('a process using it ends right after the timeout instead of waiting out the handshake', async () => {
    const code = `
      import { fetchLatest } from './src/update/check.ts';
      import { httpsFetch } from './src/update/http-get.ts';
      console.log('start');
      console.log(await fetchLatest(httpsFetch, ${TIMEOUT}, ${JSON.stringify(url)}));
    `;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let startedAt = 0;
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString();
      if (!startedAt && out.includes('start')) startedAt = Date.now();
    });
    const ended = await new Promise<number>((resolve) => child.on('close', () => resolve(Date.now())));
    expect(out).toBe('start\nundefined\n');
    expect(ended - startedAt).toBeLessThan(TIMEOUT + 500);
  });
});
