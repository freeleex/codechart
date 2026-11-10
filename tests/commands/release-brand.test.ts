import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { repoFolder } from '../../src/render/output-path.js';
import { release } from '../fixtures/release.js';
import { fakeBrowser } from '../helpers/fake-browser.js';
import { git, makeSandbox, removeSandbox, repoFromTemplate, runCli, type Sandbox } from '../helpers/sandbox.js';

let sb: Sandbox;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';

beforeEach(() => {
  sb = makeSandbox('release-brand', { htmlOut: true });
  repoFromTemplate(sb.repo);
  mkdirSync(join(sb.repo, 'docs'));
  writeFileSync(join(sb.repo, 'docs/logo.png'), PNG);
  writeFileSync(join(sb.repo, 'docs/logo.svg'), SVG);
});
afterEach(() => removeSandbox(sb.tmp));

const config = (release: object) => writeFileSync(join(sb.repo, '.codechart.yaml'), JSON.stringify({ release }));

async function render() {
  process.exitCode = undefined;
  const file = join(sb.tmp, 'release.json');
  writeFileSync(file, JSON.stringify(release()));
  const r = await runCli({ cwd: sb.repo, home: sb.home, now: () => new Date(2026, 10, 9, 10), isTTY: false, pdf: fakeBrowser() }, ['render', file]);
  const dir = join(sb.out, repoFolder(sb.repo));
  const page = readFileSync(join(dir, readdirSync(dir).find((n) => n.endsWith('.release.html'))!), 'utf8');
  return { ...r, page };
}
const images = (page: string): string[] => [...page.matchAll(/<img src="([^"]*)"/g)].map((m) => m[1]!);

describe('release.product and release.logo', () => {
  it('uses the repo name without a config', async () => {
    const r = await render();
    expect(r.page).toContain('<div class="co-product">repo</div>');
  });

  it("prefers the repo's name on its forge to the folder name", async () => {
    git(sb.repo, 'remote', 'add', 'origin', 'git@github.com:acme/shop-web.git');
    const r = await render();
    expect(r.page).toContain('<div class="co-product">shop-web</div>');
  });

  it('puts the product name and a PNG logo on the page and the cover', async () => {
    config({ product: 'Acme Shop', logo: 'docs/logo.png' });
    const r = await render();
    expect(r.err).toBe('');
    expect(r.page).toContain('<div class="co-product">Acme Shop</div>');
    expect(images(r.page)).toEqual([`data:image/png;base64,${PNG.toString('base64')}`]);
  });

  it('accepts an SVG logo, as an image data URI', async () => {
    config({ logo: 'docs/logo.svg' });
    expect(images((await render()).page)[0]).toBe(`data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`);
  });

  it.each([
    ['too big', 'docs/big.png', 'is over 200 KB', () => writeFileSync(join(sb.repo, 'docs/big.png'), Buffer.concat([PNG, Buffer.alloc(200 * 1024)]))],
    ['a wrong type', 'docs/logo.gif', 'must be an .svg or .png file', () => writeFileSync(join(sb.repo, 'docs/logo.gif'), 'GIF89a')],
    ['not really a png', 'docs/fake.png', 'is not a real PNG', () => writeFileSync(join(sb.repo, 'docs/fake.png'), 'not a png')],
    ['not really an svg', 'docs/fake.svg', 'is not a real SVG', () => writeFileSync(join(sb.repo, 'docs/fake.svg'), '<html></html>')],
    ['missing', 'docs/nope.png', 'was not found', () => undefined],
    ['outside the repo with ..', '../logo.png', 'must be a path inside the repo', () => writeFileSync(join(sb.tmp, 'logo.png'), PNG)],
    ['an absolute path', '/etc/logo.png', 'must be a path inside the repo', () => undefined],
    ['a symlink out of the repo', 'docs/link.png', 'must be a path inside the repo', () => symlinkSync(join(sb.tmp, 'outside.png'), join(sb.repo, 'docs/link.png'))],
    ['a folder', 'docs/dir.png', 'is not a regular file', () => mkdirSync(join(sb.repo, 'docs/dir.png'))],
  ])('%s: warns on stderr, leaves the logo out and still renders', async (_name, logo, why, setup) => {
    writeFileSync(join(sb.tmp, 'outside.png'), PNG);
    setup();
    config({ product: 'Acme Shop', logo });
    const r = await render();
    expect(r.err).toBe(`codechart: release.logo "${logo}" ${why}; the cover has no logo\n`);
    expect(r.code).toBeUndefined();
    expect(images(r.page)).toEqual([]);
    expect(r.page).toContain('<div class="co-product">Acme Shop</div>');
  });

  it('a symlink that stays inside the repo is fine', async () => {
    symlinkSync(join(sb.repo, 'docs/logo.png'), join(sb.repo, 'docs/alias.png'));
    config({ logo: 'docs/alias.png' });
    const r = await render();
    expect(r.err).toBe('');
    expect(images(r.page)).toHaveLength(1);
  });

  it.each([['over 80 characters', 'x'.repeat(81)], ['on two lines', 'Acme\nShop']])('a product name %s is a config error', async (_name, product) => {
    config({ product });
    const file = join(sb.tmp, 'release.json');
    writeFileSync(file, JSON.stringify(release()));
    const r = await runCli({ cwd: sb.repo, home: sb.home, isTTY: false }, ['render', file]);
    expect(r.err).toContain('release.product');
    expect(r.code).toBe(1);
  });

  it('shows in config with its source; product and logo not at all when unset', async () => {
    const out = async () => (await runCli({ cwd: sb.repo, home: sb.home, isTTY: false }, ['config'])).out;
    expect(await out()).not.toMatch(/release\.(product|logo|browser)/);
    expect(await out()).toContain('release.branches: v[0-9]*, release-*, release/*  (built-in)');
    expect(await out()).toContain('release.auto: suggest  (built-in)');
    config({ product: 'Acme Shop', logo: 'docs/logo.png' });
    expect(await out()).toContain(`release.product: Acme Shop  (repo: ${join(sb.repo, '.codechart.yaml')})`);
    expect(await out()).toContain('release.logo: docs/logo.png');
  });

  it('codechart schema --release prints the release spec schema and is exclusive with the others', async () => {
    const r = await runCli({ cwd: sb.repo, home: sb.home, isTTY: false }, ['schema', '--release']);
    expect(Object.keys(JSON.parse(r.out).properties)).toContain('sections');
    expect((await runCli({ cwd: sb.repo, home: sb.home, isTTY: false }, ['schema', '--release', '--business'])).err).toContain('mutually exclusive');
  });

  it.each([
    ['an unknown release.auto', { auto: 'always' }, 'release.auto'],
    ['a brace in release.branches', { branches: ['release-{1,2}'] }, 'braces and extglobs'],
    ['an empty release.branches', { branches: [] }, 'release.branches'],
    ['a relative release.browser in the global config', { browser: 'chrome' }, 'must be an absolute path'],
  ])('%s is a config error', async (_name, release, why) => {
    writeFileSync(join(sb.home, '.config', 'codechart', 'config.yaml'), JSON.stringify({ web: { outDir: sb.out }, release }));
    const r = await runCli({ cwd: sb.repo, home: sb.home, isTTY: false }, ['config']);
    expect(r.err).toContain(why);
    expect(r.code).toBe(1);
  });

  it('release.browser shows as global-only', async () => {
    writeFileSync(join(sb.home, '.config', 'codechart', 'config.yaml'), JSON.stringify({ web: { outDir: sb.out }, release: { browser: '/opt/chrome' } }));
    expect((await runCli({ cwd: sb.repo, home: sb.home, isTTY: false }, ['config'])).out).toMatch(/release\.browser: \/opt\/chrome  \(global: .*; global-only\)/);
  });
});
