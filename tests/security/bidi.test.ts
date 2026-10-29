import { describe, expect, it } from 'vitest';
import { esc } from '../../src/render/web/page.js';
import { flat } from '../../src/render/terminal/wrap.js';

const SPOOF = 'invoice‮fdp.exe​‏⁠⁦﻿x';

describe('S-6 bidi and zero-width characters', () => {
  it('flat strips them', () => {
    expect(flat(SPOOF)).toBe('invoicefdp.exex');
  });

  it('keeps emoji ZWJ sequences', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467} fam';
    expect(flat(family)).toBe(family);
    expect(esc(family)).toBe(family);
  });

  it('html esc strips them', () => {
    expect(esc(SPOOF)).toBe('invoicefdp.exex');
  });
});
