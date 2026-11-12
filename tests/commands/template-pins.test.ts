import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');

describe('CI templates pin their actions by commit', () => {
  it('no uses: line in templates/*.yml runs anything but a 40-character sha', () => {
    const uses = readdirSync(join(root, 'templates'))
      .filter((f) => f.endsWith('.yml'))
      .flatMap((f) => readFileSync(join(root, 'templates', f), 'utf8').split('\n').map((l) => ({ f, l })))
      .filter(({ l }) => /^\s*(?:-\s*)?uses:/.test(l));
    expect(uses.length).toBeGreaterThan(0);
    for (const { f, l } of uses) expect(l, `${f}: ${l.trim()}`).toMatch(/@[0-9a-f]{40}(?:\s|$)/);
  });

  it('the GitHub template pins the same commits as this repo’s own CI', () => {
    const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
    const template = readFileSync(join(root, 'templates', 'github-workflow.yml'), 'utf8');
    const pins = [...template.matchAll(/uses: (\S+) # (v[\d.]+)/g)].map((m) => `${m[1]} # ${m[2]}`);
    expect(pins.length).toBe(2);
    for (const pin of pins) expect(ci).toContain(pin);
  });
});
