import { describe, expect, it } from 'vitest';
import { openArgv } from '../../src/commands/open.js';

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
