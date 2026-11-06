import { gitGeneratedAttr } from '../rules/git-files.js';

const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'composer.lock',
  'go.sum',
]);

const byName = (rel: string) => LOCKFILES.has(rel.slice(rel.lastIndexOf('/') + 1)) || /\.min\.(js|css)$/.test(rel) || /(^|\/)dist\//.test(rel);

/** Files whose diff is noise: lockfiles, minified bundles and `dist/`, plus what `.gitattributes` marks `linguist-generated` (`-linguist-generated` opts a file out). */
export function generatedFiles(root: string, rels: string[]): Set<string> {
  let attr = new Map<string, boolean>();
  try {
    attr = gitGeneratedAttr(root, rels.filter((r) => !r.includes('\n')));
  } catch {
    // names alone then
  }
  return new Set(rels.filter((r) => attr.get(r) ?? byName(r)));
}
