import { execFileSync } from 'node:child_process';

const ALLOWED = [
  /^dist\/.+/,
  /^skills\/codechart\/[^/]+\.md$/,
  /^templates\/.+/,
  /^config\.schema\.json$/,
  /^package\.json$/,
  /^LICENSE$/,
  /^README\.md$/,
  /^THIRD_PARTY_NOTICES\.md$/,
];

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const out = execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8', shell: process.platform === 'win32' });
const files = JSON.parse(out)[0].files.map((f) => f.path);
const unexpected = files.filter((f) => !ALLOWED.some((re) => re.test(f)));
const missing = ['dist/cli.js', 'config.schema.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'skills/codechart/SKILL.md', 'skills/codechart/flow-guide.md', 'skills/codechart/spec-guide.md', 'templates/codechart.yaml'].filter((f) => !files.includes(f));
if (unexpected.length || missing.length) {
  console.error(`unexpected: ${unexpected.join(', ') || '-'}\nmissing: ${missing.join(', ') || '-'}`);
  process.exit(1);
}
console.log(`pack ok: ${files.length} files`);
