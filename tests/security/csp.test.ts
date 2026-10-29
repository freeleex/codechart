import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderFlowHtml } from '../../src/render/flow/html.js';
import { layoutFlow } from '../../src/render/flow/layout.js';
import { renderHtml } from '../../src/render/web/html.js';
import { layoutSpec } from '../../src/render/web/layout.js';
import { validateSpec } from '../../src/spec/schema.js';
import { sampleFlow, sampleSnippets } from '../render/flow-fixture.js';

const meta = { generatedAt: new Date('2026-10-27T12:00:00Z'), repo: 'demo' };

async function pages(): Promise<[string, string][]> {
  const v = validateSpec(JSON.parse(readFileSync('tests/fixtures/shop.spec.json', 'utf8')));
  if (!v.ok || v.spec.diagram === 'flow') throw new Error('fixture');
  const flow = sampleFlow();
  return [
    ['map', await renderHtml(v.spec, await layoutSpec(v.spec), meta)],
    ['flow', await renderFlowHtml(flow, await layoutFlow(flow), sampleSnippets(), meta)],
  ];
}

describe('S-17 CSP', () => {
  it.each(['map', 'flow'])('%s page carries a CSP whose script hash matches the inline script', async (kind) => {
    const html = (await pages()).find(([k]) => k === kind)![1];
    const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)?.[1];
    expect(csp).toBeDefined();
    // Every script tag, any case; JSON data blocks never run, so only the rest need the CSP hash.
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
    const inline = scripts.filter((m) => !/type="application\/json"/i.test(m[1]!));
    expect(scripts.length - inline.length).toBe(1);
    expect(inline).toHaveLength(1);
    const hash = createHash('sha256').update(inline[0]![2]!).digest('base64');
    expect(csp).toBe(
      `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; img-src data:; base-uri 'none'; form-action 'none'`,
    );
  });
});
