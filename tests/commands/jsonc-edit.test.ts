import { parse, parseTree, type ParseError } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';
import { removeItem } from '../../src/commands/jsonc-edit.js';

const valid = (text: string): unknown => {
  const errors: ParseError[] = [];
  const v: unknown = parse(text, errors, { allowTrailingComma: true });
  expect(errors, text).toEqual([]);
  return v;
};
const list = (text: string) => parseTree(text, [], { allowTrailingComma: true })!.children![0]!.children![1]!;
const remove = (text: string, index: number) => removeItem(text, list(text), index);

const strip = (arr: unknown) => arr as string[];
const plugins = (text: string) => strip((valid(text) as { plugins: unknown }).plugins);

describe('removeItem always leaves valid JSONC and every comment', () => {
  const cases: [string, number, string[]][] = [
    ['{"plugins":["codechart" /* keep */, "other"]}', 0, ['other']],
    ['{"plugins":["other", "codechart" /* keep */]}', 1, ['other']],
    ['{"plugins":["other", /* before */ "codechart"]}', 1, ['other']],
    ['{"plugins":["codechart", /* after */ "other"]}', 0, ['other']],
    ['{"plugins":["a", "codechart" /* c */, "b"]}', 1, ['a', 'b']],
    ['{"plugins":["a" /* x */, /* y */ "codechart"]}', 1, ['a']],
    ['{"plugins":["codechart" /* only */]}', 0, []],
    ['{"plugins":["codechart" /* c */,]}', 0, []],
    ['{"plugins":["a", "codechart" /* c */,]}', 1, ['a']],
    ['{\n  "plugins": [\n    "codechart" // note\n    , "other"\n  ]\n}', 0, ['other']],
    ['{\n  "plugins": [\n    "other",\n    "codechart" // note\n  ]\n}', 1, ['other']],
    ['{\n  "plugins": [\n    "other", // one\n    // above\n    "codechart", // two\n    "z"\n  ]\n}', 1, ['other', 'z']],
    ['{\n  "plugins": [\n    "codechart", // only\n  ]\n}', 0, []],
    ['{\n  "plugins": [\n    "codechart"\n  ]\n}', 0, []],
    ['{"plugins":["codechart"]}', 0, []],
    ['{"plugins":["codechart", "other"]}', 0, ['other']],
    ['{"plugins":["a", "codechart"]}', 1, ['a']],
  ];
  it.each(cases)('%s', (text, index, expected) => {
    const out = remove(text, index);
    expect(plugins(out)).toEqual(expected);
    for (const c of text.match(/\/\*.*?\*\/|\/\/[^\n]*/g) ?? []) expect(out).toContain(c);
  });

  it('keeps the shape of the rest in the plain case', () => {
    expect(remove('{"plugins":["a", "codechart", "b"]}', 1)).toBe('{"plugins":["a", "b"]}');
    expect(remove('{\n  "plugins": [\n    "a",\n    "codechart",\n    "b"\n  ]\n}', 1)).toBe('{\n  "plugins": [\n    "a",\n    "b"\n  ]\n}');
  });
});
