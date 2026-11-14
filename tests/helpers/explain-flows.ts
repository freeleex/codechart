import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { checkExplain, layOutFlows } from '../../src/render/explain-flows.js';
import { renderHtml } from '../../src/render/web/html.js';
import { layoutSpec } from '../../src/render/web/layout.js';
import { validateSpec } from '../../src/spec/schema.js';
import { EXPLAIN_FILES, withFlows } from '../fixtures/explain.js';
import { makeTempDir, removeTempDir } from './sandbox.js';

const repos: string[] = [];
afterAll(() => repos.splice(0).forEach(removeTempDir));

/** A folder with the files the explain fixtures anchor to. */
export function explainRepo(): string {
  const repo = makeTempDir('explain-flows');
  repos.push(repo);
  for (const [file, text] of Object.entries(EXPLAIN_FILES)) {
    mkdirSync(join(repo, file, '..'), { recursive: true });
    writeFileSync(join(repo, file), text);
  }
  return repo;
}

/** The explain map with flows as the page the CLI writes; `repo` is where the anchors are read. */
export async function explainFlowsPage(repo: string, raw: object = withFlows(), change?: { slug: string; branch: string; at: string }): Promise<string> {
  const r = validateSpec(raw);
  if (!r.ok || r.spec.diagram === 'flow') throw new Error(r.ok ? 'fixture' : r.errors.join('\n'));
  const check = await layOutFlows(checkExplain(r.spec, repo));
  const meta = { generatedAt: new Date('2026-11-10T12:00:00Z'), repo: 'demo', ...(change && { change }) };
  return renderHtml(r.spec, await layoutSpec(r.spec), meta, check);
}
