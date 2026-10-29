// ZWJ (U+200D) stays: emoji sequences need it.
// Bidi overrides and zero-width characters let a label spoof another name.
const INVISIBLE = /[\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

export const stripInvisible = (s: string): string => s.replace(INVISIBLE, '');

// Keeps \n and \t; the rest of C0, DEL and C1 can drive a terminal (OSC 8/52, clear screen).
export const sanitizeText = (s: string): string =>
  stripInvisible(s).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');

// JSON.stringify leaves DEL, C1, bidi and zero-width raw; they only occur inside strings, so \u escapes are safe.
export const escapeJsonControls = (json: string): string =>
  json.replace(/[\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

// Identifiers must stay distinct after stripping, so they may hold none of these (ZWJ included).
export const hasHiddenChars = (s: string): boolean => /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/.test(s);
