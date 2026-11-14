import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

describe('THIRD_PARTY_NOTICES.md', () => {
  it('names each runtime dependency at the version package.json pins', () => {
    const { dependencies } = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    const notices = read('THIRD_PARTY_NOTICES.md');
    const named = Object.entries(dependencies).filter(([name]) => new RegExp(`^## ${name} `, 'm').test(notices));
    expect(named.length).toBeGreaterThan(0);
    for (const [name, version] of named) expect(notices).toContain(`## ${name} ${version}\n`);
  });
});
