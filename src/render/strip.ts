// ZWJ (U+200D) and VS16 (U+FE0F) stay: emoji sequences need them.
// Bidi overrides, zero-width, fillers, variation selectors and Unicode tags let a label spoof another name or smuggle text to an LLM.
const EXTRA = '\\u00ad\\u034f\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u180b-\\u180e\\u3164\\ufe00-\\ufe0e\\uffa0\\ufff9-\\ufffb\\u{e0000}-\\u{e007f}\\u{e0100}-\\u{e01ef}';
const INVISIBLE = new RegExp(`[\\u200b\\u200c\\u200e\\u200f\\u202a-\\u202e\\u2060-\\u2069\\ufeff${EXTRA}]`, 'gu');

export const stripInvisible = (s: string): string => s.replace(INVISIBLE, '');

// Keeps \n and \t; the rest of C0, DEL and C1 can drive a terminal (OSC 8/52, clear screen).
export const sanitizeText = (s: string): string =>
  stripInvisible(s).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');

const JSON_ESCAPE = new RegExp(`[\\u007f-\\u009f\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2060-\\u2069\\ufeff${EXTRA}]`, 'gu');

// JSON.stringify leaves DEL, C1, bidi, zero-width and tag chars raw; they only occur inside strings, so \u escapes are safe.
export const escapeJsonControls = (json: string): string =>
  json.replace(JSON_ESCAPE, (c) => {
    const n = c.codePointAt(0)!;
    return n > 0xffff
      ? c.split('').map((u) => `\\u${u.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')
      : `\\u${n.toString(16).padStart(4, '0')}`;
  });

const HIDDEN = new RegExp(`[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2069\\ufeff${EXTRA}]`, 'u');

// Identifiers must stay distinct after stripping, so they may hold none of these (ZWJ included).
export const hasHiddenChars = (s: string): boolean => HIDDEN.test(s);
