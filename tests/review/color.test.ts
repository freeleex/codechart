import { describe, expect, it } from 'vitest';
import { colorDoc } from '../../src/review/color.js';

const E = '\u001b[';

describe('colorDoc', () => {
  it('colours each kind of line and leaves context rows alone', () => {
    const doc = ['# comment', '## orders — a.py  [o]', '@@ -1 +1 @@', '   1  keep', '-  2  gone', '+  2  new', '>? why', '  > and how', ''].join('\n');
    expect(colorDoc(doc).split('\n')).toEqual([
      `${E}2m# comment${E}0m`,
      `${E}1m## orders — a.py  [o]${E}0m`,
      `${E}36m@@ -1 +1 @@${E}0m`,
      '   1  keep',
      `${E}31m-  2  gone${E}0m`,
      `${E}32m+  2  new${E}0m`,
      `${E}30;43m>? why${E}0m`,
      `${E}30;43m  > and how${E}0m`,
      '',
    ]);
  });
});
