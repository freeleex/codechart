import { existsSync, mkdirSync, readdirSync, readFileSync, type rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { browserArgs, findBrowser, pdfFlagPath, printPdf } from '../../src/commands/release-pdf.js';
import { repoFolder } from '../../src/render/output-path.js';
import { release } from '../fixtures/release.js';
import { fakeBrowser, printTarget } from '../helpers/fake-browser.js';
import { makeSandbox, removeSandbox, repoFromTemplate, runCli, type Sandbox } from '../helpers/sandbox.js';

const has = (...files: string[]) => (p: string) => files.includes(p);

describe('findBrowser', () => {
  it('uses release.browser when it exists, and only it', () => {
    expect(findBrowser({ configured: '/opt/chrome', platform: 'linux', env: { PATH: '/usr/bin' }, exists: has('/opt/chrome', '/usr/bin/chromium') })).toBe('/opt/chrome');
    expect(findBrowser({ configured: '/opt/gone', platform: 'linux', env: { PATH: '/usr/bin' }, exists: has('/usr/bin/chromium') })).toBeUndefined();
  });

  it('macOS: Chrome, Chromium, Edge, Brave in /Applications, in that order', () => {
    const chromium = '/Applications/Chromium.app/Contents/MacOS/Chromium';
    const brave = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
    expect(findBrowser({ platform: 'darwin', exists: has(brave, chromium) })).toBe(chromium);
    expect(findBrowser({ platform: 'darwin', exists: has(brave) })).toBe(brave);
    expect(findBrowser({ platform: 'darwin', exists: has('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') })).toContain('Google Chrome');
    expect(findBrowser({ platform: 'darwin', exists: () => false })).toBeUndefined();
  });

  it('Linux: the known names in absolute PATH entries only, never a relative one', () => {
    const env = { PATH: '.:bin:/opt/none::/usr/local/bin:/usr/bin' };
    expect(findBrowser({ platform: 'linux', env, exists: has('/usr/bin/chromium-browser', '/usr/local/bin/google-chrome') })).toBe('/usr/local/bin/google-chrome');
    expect(findBrowser({ platform: 'linux', env, exists: has('./google-chrome', 'bin/chromium', 'google-chrome') })).toBeUndefined();
    expect(findBrowser({ platform: 'linux', env: {}, exists: () => true })).toBeUndefined();
    for (const name of ['google-chrome-stable', 'chromium', 'microsoft-edge']) {
      expect(findBrowser({ platform: 'linux', env: { PATH: '/usr/bin' }, exists: has(`/usr/bin/${name}`) })).toBe(`/usr/bin/${name}`);
    }
  });

  it('Windows: Chrome and Edge under Program Files, Program Files (x86) and LOCALAPPDATA; PATH is not searched', () => {
    const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', PATH: 'C:\\bin;.' };
    const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const local = 'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
    expect(findBrowser({ platform: 'win32', env, exists: has(edge, local) })).toBe(local);
    expect(findBrowser({ platform: 'win32', env, exists: has(edge) })).toBe(edge);
    expect(findBrowser({ platform: 'win32', env, exists: has('C:\\bin\\chrome.exe', '.\\chrome.exe', 'chrome.exe') })).toBeUndefined();
    expect(findBrowser({ platform: 'win32', env: {}, exists: () => true })).toBeUndefined();
  });
});

describe('browserArgs', () => {
  it('prints the local file headless with a fresh profile and no header or footer', () => {
    expect(browserArgs('/tmp/out/a b.html', '/tmp/x.pdf', '/tmp/profile')).toEqual([
      '--headless=new',
      '--disable-gpu',
      '--no-pdf-header-footer',
      '--no-first-run',
      '--no-default-browser-check',
      '--user-data-dir=/tmp/profile',
      '--print-to-pdf=/tmp/x.pdf',
      pathToFileURL('/tmp/out/a b.html').href,
    ]);
  });
});

describe('printPdf', () => {
  let sb: Sandbox;
  beforeEach(() => {
    sb = makeSandbox('release-pdf-print');
  });
  afterEach(() => removeSandbox(sb.tmp));

  it('copies the printed PDF and removes the throwaway profile', async () => {
    const calls: { browser: string; args: string[] }[] = [];
    const out = join(sb.tmp, 'out.pdf');
    expect(await printPdf('/fake/chrome', '/x/a.html', out, fakeBrowser(calls).run)).toBeUndefined();
    expect(readFileSync(out, 'latin1').startsWith('%PDF')).toBe(true);
    const profile = calls[0]!.args.find((a) => a.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length);
    expect(profile.startsWith(tmpdir())).toBe(true);
    expect(existsSync(profile)).toBe(false);
  });

  it('reports a failing browser and leaves nothing at the destination', async () => {
    const out = join(sb.tmp, 'out.pdf');
    expect(await printPdf('/fake/chrome', '/x/a.html', out, async () => Promise.reject(new Error('Command failed: boom\nmore')))).toBe('Command failed: boom');
    expect(existsSync(out)).toBe(false);
  });

  it('a profile folder that cannot be removed never replaces the result', async () => {
    const out = join(sb.tmp, 'out.pdf');
    const locked = (() => {
      throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
    }) as typeof rmSync;
    expect(await printPdf('/fake/chrome', '/x/a.html', out, fakeBrowser().run, locked)).toBeUndefined();
    expect(await printPdf('/fake/chrome', '/x/a.html', out, async () => Promise.reject(new Error('boom')), locked)).toBe('boom');
  });

  it('a browser that exits 0 without a PDF, or with something else, is a failure', async () => {
    const out = join(sb.tmp, 'out.pdf');
    expect(await printPdf('/fake/chrome', '/x/a.html', out, async () => undefined)).toBe('the browser finished but wrote no PDF');
    expect(await printPdf('/fake/chrome', '/x/a.html', out, async (_b, args) => writeFileSync(printTarget(args), '<html>'))).toBe('the browser finished but wrote no PDF');
    expect(existsSync(out)).toBe(false);
  });
});

describe('--pdf', () => {
  let sb: Sandbox;
  beforeEach(() => {
    sb = makeSandbox('release-pdf-flag');
  });
  afterEach(() => removeSandbox(sb.tmp));

  it('takes an absolute or cwd-relative path that ends in .pdf in an existing folder', () => {
    mkdirSync(join(sb.tmp, 'out'));
    expect(pdfFlagPath(join(sb.tmp, 'out', 'a.pdf'), '/elsewhere')).toBe(join(sb.tmp, 'out', 'a.pdf'));
    expect(pdfFlagPath('out/B.PDF', sb.tmp)).toBe(join(sb.tmp, 'out', 'B.PDF'));
  });

  it('refuses another extension and a missing folder', () => {
    expect(() => pdfFlagPath('a.html', sb.tmp)).toThrow('--pdf must end in .pdf');
    expect(() => pdfFlagPath('nope/a.pdf', sb.tmp)).toThrow(`--pdf: ${join(sb.tmp, 'nope')} is not a folder`);
    expect(() => pdfFlagPath(join(sb.tmp, 'repo-less.txt', 'a.pdf'), sb.tmp)).toThrow('is not a folder');
  });
});

describe('codechart render of a release map', () => {
  let sb: Sandbox;
  const NOW = new Date(2026, 10, 9, 10);

  beforeEach(() => {
    sb = makeSandbox('release-pdf-render', { htmlOut: true });
    repoFromTemplate(sb.repo);
  });
  afterEach(() => removeSandbox(sb.tmp));

  async function render(pdf: Parameters<typeof runCli>[0]['pdf'], ...extra: string[]) {
    process.exitCode = undefined;
    const file = join(sb.tmp, 'release.json');
    writeFileSync(file, JSON.stringify(release()));
    const r = await runCli({ cwd: sb.repo, home: sb.home, now: () => NOW, isTTY: false, pdf }, ['render', file, ...extra]);
    const dir = join(sb.out, repoFolder(sb.repo));
    return { ...r, dir, files: existsSync(dir) ? readdirSync(dir) : [] };
  }

  it('writes the page and the PDF next to it and prints the summary, the PDF and the page link', async () => {
    const calls: { browser: string; args: string[] }[] = [];
    const r = await render(fakeBrowser(calls));
    const name = '20261109-100000-v2-0-0--what-is-new-in-shop-2-0.release';
    expect(r.files).toEqual([`${name}.html`, `${name}.pdf`]);
    expect(r.err).toBe('');
    expect(r.out.split('\n')).toEqual([
      'Release map: What is new in Shop 2.0 (2.0.0) · 3 features · 1 new · 1 changed · 1 fixed',
      `PDF: ${join(r.dir, `${name}.pdf`)}`,
      `full map → ${pathToFileURL(join(r.dir, `${name}.html`)).href}`,
      '',
    ]);
    expect(readFileSync(join(r.dir, `${name}.pdf`), 'latin1').startsWith('%PDF')).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.browser).toBe('/fake/chrome');
    expect(calls[0]!.args[0]).toBe('--headless=new');
    expect(calls[0]!.args.at(-1)).toBe(pathToFileURL(join(r.dir, `${name}.html`)).href);
  });

  it('writes no review file: nothing of a release map is sent back', async () => {
    const r = await render(fakeBrowser());
    expect(r.files.filter((f) => f.includes('review'))).toEqual([]);
  });

  it('--md prints the summary and the PDF path as a block with the page link', async () => {
    const r = await render(fakeBrowser(), '--md');
    expect(r.out).toMatch(/^\*\*Release map\*\*\n```text\nRelease map: What is new in Shop 2\.0 \(2\.0\.0\) · 3 features · 1 new · 1 changed · 1 fixed\nPDF: .*\.release\.pdf\n```\n\n\[Open full map\]\(file:\/\//);
  });

  it('--md keeps a hostile title inside the fence: outside it only the constant header and the link', async () => {
    const file = join(sb.tmp, 'hostile.json');
    writeFileSync(file, JSON.stringify({ ...release(), title: '![](//1.2.3.4/a) <h1>big</h1>' }));
    process.exitCode = undefined;
    const r = await runCli({ cwd: sb.repo, home: sb.home, now: () => NOW, isTTY: false, pdf: fakeBrowser() }, ['render', file, '--md']);
    const outside = r.out.replace(/```text\n[\s\S]*?\n```\n/, '');
    expect(r.out).toContain('![](//1.2.3.4/a) <h1>big</h1>');
    expect(outside).toMatch(/^\*\*Release map\*\*\n\n\[Open full map\]\(file:\/\/[^\n]*\)\n$/);
  });

  it('a release map with --pr or --tech is refused', async () => {
    const file = join(sb.tmp, 'release.json');
    writeFileSync(file, JSON.stringify(release()));
    for (const [flag, message] of [['--pr', 'release maps are not for PR descriptions'], ['--tech', '--tech only applies to business maps']] as const) {
      process.exitCode = undefined;
      const r = await runCli({ cwd: sb.repo, home: sb.home, now: () => NOW, isTTY: false, pdf: fakeBrowser() }, ['render', file, flag, ...(flag === '--tech' ? [file] : [])]);
      expect(r.err).toBe(`codechart: ${message}\n`);
      expect(r.code).toBe(2);
    }
  });

  it('--pdf puts the PDF where asked', async () => {
    mkdirSync(join(sb.tmp, 'share'));
    const r = await render(fakeBrowser(), '--pdf', join(sb.tmp, 'share', 'notes.pdf'));
    expect(readFileSync(join(sb.tmp, 'share', 'notes.pdf'), 'latin1').startsWith('%PDF')).toBe(true);
    expect(r.files.filter((f) => f.endsWith('.pdf'))).toEqual([]);
    expect(r.out).toContain(`PDF: ${join(sb.tmp, 'share', 'notes.pdf')}`);
  });

  it('a bad --pdf stops before anything is written', async () => {
    const r = await render(fakeBrowser(), '--pdf', 'notes.txt');
    expect(r.err).toBe('codechart: --pdf must end in .pdf\n');
    expect(r.code).toBe(1);
    expect(r.files).toEqual([]);
    const gone = await render(fakeBrowser(), '--pdf', join(sb.tmp, 'nope', 'a.pdf'));
    expect(gone.err).toContain('is not a folder');
    expect(gone.files).toEqual([]);
  });

  it('--pdf on another kind of spec is an error', async () => {
    const file = join(sb.tmp, 'tech.json');
    writeFileSync(file, JSON.stringify({ title: 'T', kind: 'plan', nodes: [{ id: 'a', label: 'a', kind: 'service', status: 'new', layer: 'backend' }], edges: [] }));
    const r = await runCli({ cwd: sb.repo, home: sb.home, isTTY: false }, ['render', file, '--pdf', 'a.pdf']);
    expect(r.err).toBe('codechart: --pdf only applies to release maps\n');
  });

  it('no browser: keeps the page, says how to get a PDF in one line, and exits 0', async () => {
    const r = await render({ find: () => undefined });
    expect(r.files).toEqual(['20261109-100000-v2-0-0--what-is-new-in-shop-2-0.release.html']);
    expect(r.err).toBe(`codechart: no PDF (no Chromium-based browser found): open ${join(r.dir, r.files[0]!)} in a browser and use Save as PDF, or set release.browser to a Chrome, Chromium, Edge or Brave path in your global config\n`);
    expect(r.code).toBeUndefined();
    expect(r.out).not.toContain('PDF:');
    expect(r.out).toContain('Release map: What is new in Shop 2.0 (2.0.0)');
    expect(r.out).toContain('full map → file://');
  });

  it('release.browser set to a path that does not exist is named, the page is kept, exit 0', async () => {
    writeFileSync(join(sb.home, '.config', 'codechart', 'config.yaml'), `web:\n  outDir: ${sb.out}\nrelease:\n  browser: /opt/gone-chrome\n`);
    const r = await render({ find: () => undefined });
    expect(r.files).toEqual(['20261109-100000-v2-0-0--what-is-new-in-shop-2-0.release.html']);
    expect(r.err).toBe("codechart: no PDF: release.browser /opt/gone-chrome doesn't exist\n");
    expect(r.code).toBeUndefined();
  });

  it('a browser that fails: same fallback, with the reason', async () => {
    const r = await render({ find: () => '/fake/chrome', run: async () => Promise.reject(new Error('Command failed: chrome')) });
    expect(r.files.filter((f) => f.endsWith('.pdf'))).toEqual([]);
    expect(r.err).toContain('codechart: no PDF (Command failed: chrome): open ');
    expect(r.err.trim().split('\n')).toHaveLength(1);
    expect(r.code).toBeUndefined();
  });

  it('release.browser from the global config is what is launched; in a repo config it is ignored with a warning', async () => {
    writeFileSync(join(sb.home, '.config', 'codechart', 'config.yaml'), `web:\n  outDir: ${sb.out}\nrelease:\n  browser: /opt/my-chrome\n`);
    writeFileSync(join(sb.repo, '.codechart.yaml'), 'release:\n  browser: /tmp/evil\n');
    const seen: (string | undefined)[] = [];
    const fake = fakeBrowser();
    const r = await render({ ...fake, find: (configured) => (seen.push(configured), '/fake/chrome') });
    expect(seen).toEqual(['/opt/my-chrome']);
    expect(r.err).toBe(`codechart: ${join(sb.repo, '.codechart.yaml')}: release.browser is global-only; ignored\n`);
  });

  it('a second render of the same release replaces the first page', async () => {
    await render(fakeBrowser());
    const first = readdirSync(join(sb.out, repoFolder(sb.repo)));
    process.exitCode = undefined;
    const file = join(sb.tmp, 'release.json');
    await runCli({ cwd: sb.repo, home: sb.home, now: () => new Date(2026, 10, 9, 11), isTTY: false, pdf: fakeBrowser() }, ['render', file]);
    const after = readdirSync(join(sb.out, repoFolder(sb.repo)));
    expect(first.filter((f) => f.endsWith('.html'))).toHaveLength(1);
    expect(after.filter((f) => f.endsWith('.release.html'))).toEqual(['20261109-110000-v2-0-0--what-is-new-in-shop-2-0.release.html']);
  });
});

// Skipped on machines with no Chromium-based browser.
describe('a real browser', () => {
  const browser = findBrowser();
  it.skipIf(!browser)('prints the release page to a PDF with a cover and the features', { timeout: 60_000, retry: 2 }, async () => {
    const sb = makeSandbox('release-pdf-real', { htmlOut: true });
    try {
      repoFromTemplate(sb.repo);
      const file = join(sb.tmp, 'release.json');
      writeFileSync(file, JSON.stringify(release()));
      const r = await runCli({ cwd: sb.repo, home: sb.home, now: () => new Date(2026, 10, 9, 10), isTTY: false, pdf: { find: () => browser } }, ['render', file]);
      expect(r.err, r.err).toBe('');
      const pdf = join(sb.out, repoFolder(sb.repo), readdirSync(join(sb.out, repoFolder(sb.repo))).find((n) => n.endsWith('.pdf'))!);
      expect(readFileSync(pdf, 'latin1').startsWith('%PDF')).toBe(true);
      expect(statSync(pdf).size).toBeGreaterThan(5_000);
    } finally {
      removeSandbox(sb.tmp);
    }
  });
});
