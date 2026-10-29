import { describe, expect, it } from 'vitest';
import type { spawn, spawnSync } from 'node:child_process';
import { openArgv, openInBrowser } from '../../src/commands/open.js';

const hostile = 'C:\\x&calc&\\a^b%PATH%.html';

describe('S-3 --open argv', () => {
  it('win32 uses rundll32, never cmd', () => {
    expect(openArgv('win32', hostile, {})).toEqual(['C:\\Windows\\System32\\rundll32.exe', ['url.dll,FileProtocolHandler', hostile]]);
  });

  it('darwin uses open', () => {
    expect(openArgv('darwin', '/a b')).toEqual(['open', ['/a b']]);
  });

  it('other platforms use xdg-open', () => {
    expect(openArgv('linux', '/a')).toEqual(['xdg-open', ['/a']]);
  });
});

describe('openInBrowser outcomes', () => {
  const result = (r: Record<string, unknown>) => (() => ({ status: null, signal: null, stderr: '', ...r })) as unknown as typeof spawnSync;

  it('macOS and Windows: exit 0 counts as opened, with the exact argv and a timeout', () => {
    const calls: unknown[][] = [];
    const run = ((...a: unknown[]) => (calls.push(a), { status: 0, stderr: '' })) as unknown as typeof spawnSync;
    expect(openInBrowser('/a b.html', { platform: 'darwin', run })).toBeUndefined();
    expect(calls[0]!.slice(0, 2)).toEqual(['open', ['/a b.html']]);
    expect(calls[0]![2]).toMatchObject({ timeout: 10_000 });
    expect(openInBrowser('C:\\a.html', { platform: 'win32', run: result({ status: 0 }) })).toBeUndefined();
  });

  it('a failed exit returns the status and the first stderr line', () => {
    const err = '_LSOpenURLsWithCompletionHandler() failed with error -54 for the file /a.html.\nmore';
    expect(openInBrowser('/a.html', { platform: 'darwin', run: result({ status: 1, stderr: err }) })).toBe(
      'open exited with 1: _LSOpenURLsWithCompletionHandler() failed with error -54 for the file /a.html.',
    );
    expect(openInBrowser('/a.html', { platform: 'darwin', run: result({ status: 1 }) })).toBe('open exited with 1');
  });

  it('a spawn error is returned; a timeout counts as opened (slow cold start)', () => {
    expect(openInBrowser('/a.html', { platform: 'darwin', run: result({ error: new Error('spawn open ENOENT') }) })).toBe('spawn open ENOENT');
    const timeout = Object.assign(new Error('spawnSync open ETIMEDOUT'), { code: 'ETIMEDOUT' });
    expect(openInBrowser('/a.html', { platform: 'darwin', run: result({ error: timeout }) })).toBeUndefined();
  });

  it('linux detaches xdg-open and never waits', () => {
    const calls: unknown[][] = [];
    const child = { on: () => child, unref: () => undefined };
    const detach = ((...a: unknown[]) => (calls.push(a), child)) as unknown as typeof spawn;
    const run = (() => {
      throw new Error('must not wait on linux');
    }) as unknown as typeof spawnSync;
    expect(openInBrowser('/a.html', { platform: 'linux', run, detach })).toBeUndefined();
    expect(calls[0]!.slice(0, 2)).toEqual(['xdg-open', ['/a.html']]);
    expect(calls[0]![2]).toMatchObject({ detached: true });
  });
});
