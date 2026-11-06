import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { currentVersion } from '../../src/update/check.js';

const notes = (version: string) => spawnSync(process.execPath, ['scripts/release-notes.mjs', version], { encoding: 'utf8' });

describe('scripts/release-notes.mjs', () => {
  it("prints a version's section without its heading or the next version's", () => {
    const r = notes('0.4.0');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^### New\n\n- Maps in pull and merge requests/);
    expect(r.stdout).not.toContain('## 0.');
    expect(r.stdout).not.toContain('doctor');
  });

  it('exits 1 with a message for a version with no section', () => {
    const r = notes('99.0.0');
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('CHANGELOG.md has no section for 99.0.0');
  });

  it('exits 1 without a version', () => {
    expect(spawnSync(process.execPath, ['scripts/release-notes.mjs'], { encoding: 'utf8' }).status).toBe(1);
  });
});

describe('CHANGELOG.md', () => {
  it("has notes for package.json's version, newest first", () => {
    expect(notes(currentVersion()).status).toBe(0);
    const first = /^## (\d+\.\d+\.\d+) \(\d{4}-\d{2}-\d{2}\)$/m.exec(readFileSync('CHANGELOG.md', 'utf8'));
    expect(first?.[1]).toBe(currentVersion());
  });
});
