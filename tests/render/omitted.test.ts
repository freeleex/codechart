import { describe, expect, it } from 'vitest';
import { entryPaths, entryProse, entryWords, explains } from '../../src/render/omitted.js';

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

describe('the words and paths of an omitted entry', () => {
  it('paths are globs, folders and paths with a slash; file names and words are not', () => {
    expect(entryPaths('frontend pages calling telemetry: frontend/src/pages/, frontend/src/components/')).toEqual(['frontend/src/pages/', 'frontend/src/components/']);
    expect(entryPaths('tests: backend/tests/*, frontend/src/**/*.test.*, test_teams.py')).toEqual(['backend/tests/*', 'frontend/src/**/*.test.*']);
    expect(entryPaths('docs: README.md, CHANGELOG.md')).toEqual([]);
  });

  it('plain words leave out paths, file names, counts and stop words', () => {
    expect(entryWords('frontend pages and components calling telemetry: frontend/src/pages/')).toHaveLength(5);
    expect(entryWords('~25 services rewritten from log() to log_event: backend/app/services/')).toContain('log_event');
    expect(entryWords('tests: backend/tests/*, frontend/src/**/*.test.*')).toEqual(['tests']);
    expect(entryWords('docs: README.md, CLAUDE.md')).toEqual(['docs']);
    expect(entryWords('tests and docs: tests/*, docs/*')).toEqual(['tests', 'docs']);
  });

  it('the prose keeps the reason, without the paths', () => {
    expect(entryProse('frontend pages and components calling telemetry: frontend/src/pages/, frontend/src/components/')).toBe('frontend pages and components calling telemetry');
    expect(entryProse('tests: frontend/src/**/*.test.*')).toBe('tests');
  });
});
