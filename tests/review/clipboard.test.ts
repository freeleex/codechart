import { describe, expect, it } from 'vitest';
import { readClipboard } from '../../src/review/clipboard.js';

const NO_CLIPBOARD = "Can't read the clipboard here. Pipe the copied review in instead: codechart feedback --import < review.txt";

describe('readClipboard', () => {
  it('on Windows runs the powershell.exe from an absolute PATH entry, never the bare name', () => {
    const calls: string[][] = [];
    const text = readClipboard(1024, {
      platform: 'win32',
      env: { PATH: '.;C:\\Windows\\System32\\WindowsPowerShell\\v1.0' },
      exists: (p) => p === 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      exec: (file, args) => {
        calls.push([file, ...args]);
        return 'copied text';
      },
    });
    expect(text).toBe('copied text');
    expect(calls).toEqual([['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', '-NoProfile', '-Command', 'Get-Clipboard']]);
  });

  it('on Windows a powershell off PATH fails like a reader that does not run', () => {
    expect(() =>
      readClipboard(1024, {
        platform: 'win32',
        env: { PATH: '.;C:\\nope' },
        exists: () => false,
        exec: () => {
          throw new Error('must not run');
        },
      }),
    ).toThrow(NO_CLIPBOARD);
  });

  it('off Windows the reader names pass through as they are', () => {
    const calls: string[] = [];
    const text = readClipboard(1024, {
      platform: 'darwin',
      exec: (file) => {
        calls.push(file);
        return 'copied text';
      },
    });
    expect(text).toBe('copied text');
    expect(calls).toEqual(['pbpaste']);
  });
});
