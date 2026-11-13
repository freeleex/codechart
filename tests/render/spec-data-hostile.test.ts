import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { businessPage } from '../../src/render/business/html.js';
import { renderHtml } from '../../src/render/web/html.js';
import { layoutSpec } from '../../src/render/web/layout.js';
import { validateBusinessSpec } from '../../src/spec/business.js';
import { validateSpec } from '../../src/spec/schema.js';
import { business } from '../fixtures/business.js';

const BRANCH = 'x</script><b>pwn';
const change = { slug: 'refunds', branch: BRANCH, at: '2026-11-08T12:00:00.000Z' };
const meta = { generatedAt: new Date('2026-11-08T12:00:00Z'), repo: 'demo', change };

function expectSafe(page: string) {
  expect(page).not.toContain('</script><b>');
  expect(page.match(/<\/script>/g)).toHaveLength(page.match(/<script/g)!.length);
  const text = /<script type="application\/json" id="spec-data">([\s\S]*?)<\/script>/.exec(page)![1]!;
  expect(JSON.parse(text).change.branch).toBe(BRANCH);
}

describe('spec-data survives a hostile branch name', () => {
  it('on the map page', async () => {
    const result = validateSpec(JSON.parse(readFileSync('tests/fixtures/shop.spec.json', 'utf8')));
    if (!result.ok || result.spec.diagram === 'flow') throw new Error('bad fixture');
    expectSafe(renderHtml(result.spec, await layoutSpec(result.spec), meta));
  });

  it('on the business page', () => {
    const parsed = validateBusinessSpec(business());
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    expectSafe(businessPage(parsed.spec, meta));
  });
});
