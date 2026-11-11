import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { renderFlowHtml } from '../../src/render/flow/html.js';
import { layoutFlow } from '../../src/render/flow/layout.js';
import { businessPage } from '../../src/render/business/html.js';
import { releasePage } from '../../src/render/release/html.js';
import { renderHtml } from '../../src/render/web/html.js';
import { layoutSpec } from '../../src/render/web/layout.js';
import { validateBusinessSpec } from '../../src/spec/business.js';
import { validateReleaseSpec } from '../../src/spec/release.js';
import { validateSpec } from '../../src/spec/schema.js';
import { business, businessExplain } from '../fixtures/business.js';
import { explain } from '../fixtures/explain.js';
import { explainFlowsPage, explainRepo } from '../helpers/explain-flows.js';
import { release } from '../fixtures/release.js';
import { sampleFlow, sampleSnippets } from '../render/flow-fixture.js';

const meta = { generatedAt: new Date('2026-10-27T12:00:00Z'), repo: 'demo' };

async function pages(): Promise<[string, string][]> {
  const v = validateSpec(JSON.parse(readFileSync('tests/fixtures/shop.spec.json', 'utf8')));
  if (!v.ok || v.spec.diagram === 'flow') throw new Error('fixture');
  const flow = sampleFlow();
  const b = validateBusinessSpec(business());
  const be = validateBusinessSpec(businessExplain());
  const r = validateReleaseSpec(release());
  const e = validateSpec(explain());
  if (!b.ok || !be.ok || !r.ok || !e.ok || e.spec.diagram === 'flow') throw new Error('fixture');
  return [
    ['map', await renderHtml(v.spec, await layoutSpec(v.spec), meta)],
    ['explain', await renderHtml(e.spec, await layoutSpec(e.spec), meta)],
    ['explain-flows', await explainFlowsPage(explainRepo())],
    ['flow', await renderFlowHtml(flow, await layoutFlow(flow), sampleSnippets(), meta)],
    ['business', businessPage(b.spec, meta)],
    ['business-explain', businessPage(be.spec, meta)],
    ['release', releasePage(r.spec, meta, { product: 'Acme', logo: 'data:image/png;base64,AAAA' })],
  ];
}

describe('S-17 CSP', () => {
  it.each(['map', 'explain', 'explain-flows', 'flow', 'business', 'business-explain'])('%s page carries a CSP whose script hash matches the inline script', async (kind) => {
    const html = (await pages()).find(([k]) => k === kind)![1];
    const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)?.[1];
    expect(csp).toBeDefined();
    // Parse rather than regex-match: every <script> element, however it is written. JSON data blocks never run.
    const doc = new new Window().DOMParser().parseFromString(html, 'text/html');
    const scripts = [...doc.querySelectorAll('script')];
    const inline = scripts.filter((el) => el.getAttribute('type') !== 'application/json');
    expect(scripts.length - inline.length).toBe(1);
    expect(inline).toHaveLength(1);
    const hash = createHash('sha256').update(inline[0]!.textContent).digest('base64');
    expect(csp).toBe(
      `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; img-src data:; base-uri 'none'; form-action 'none'`,
    );
  });

  it('the release page has no script at all, so its CSP has no script-src and allows only inline styles and data: images', async () => {
    const html = (await pages()).find(([k]) => k === 'release')![1];
    const doc = new new Window().DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('script')).toHaveLength(0);
    expect(html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"`);
    expect(html).not.toContain('script-src');
    expect([...doc.querySelectorAll('img')].every((i) => i.getAttribute('src')!.startsWith('data:'))).toBe(true);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/(?:src|href)="https?:/i);
  });
});
