import { readFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) {
  console.error('usage: node scripts/release-notes.mjs <version>');
  process.exit(1);
}
const lines = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith(`## ${version} `) || l === `## ${version}`);
const end = start < 0 ? -1 : lines.findIndex((l, i) => i > start && l.startsWith('## '));
const body = start < 0 ? '' : lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
if (!body) {
  console.error(`CHANGELOG.md has no ${start < 0 ? 'section' : 'notes'} for ${version}: add "## ${version} (YYYY-MM-DD)" with its changes`);
  process.exit(1);
}
console.log(body);
