import { describe, expect, it } from 'vitest';
import { explains } from '../../src/render/omitted.js';

describe('explains: an omitted entry names a changed file', () => {
  it('by repo path, file name, folder or glob', () => {
    expect(explains('docs: CHANGELOG.md, .env.example', 'CHANGELOG.md')).toBe(true);
    expect(explains('tests: test_teams.py', 'tests/api/test_teams.py')).toBe(true);
    expect(explains('tests: tests/api/test_teams.py', 'tests/api/test_teams.py')).toBe(true);
    expect(explains('fixtures (tests/fixtures/)', 'tests/fixtures/a.json')).toBe(true);
    expect(explains('tests: tests/**/*.test.ts', 'tests/render/a.test.ts')).toBe(true);
    expect(explains('tests: *.test.ts', 'tests/render/a.test.ts')).toBe(true);
  });

  it('a name with spaces or parentheses, and globs with ? or [...]', () => {
    expect(explains('docs: release notes.md', 'docs/release notes.md')).toBe(true);
    expect(explains('docs: docs/release notes (draft).md', 'docs/release notes (draft).md')).toBe(true);
    expect(explains('tests: tests/test?.ts', 'tests/test1.ts')).toBe(true);
    expect(explains('tests: tests/test[12].ts', 'tests/test2.ts')).toBe(true);
    expect(explains('tests: tests/test[12].ts', 'tests/test3.ts')).toBe(false);
  });

  it('not by a piece of a name, a folder without its slash, or a reason alone', () => {
    expect(explains('tests: a.ts', 'src/data.ts')).toBe(false);
    expect(explains('tests: tests', 'tests/a.test.ts')).toBe(false);
    expect(explains('docs', 'docs/guide.md')).toBe(false);
    expect(explains('tests: test_teams.py', 'tests/test_users.py')).toBe(false);
  });
});
