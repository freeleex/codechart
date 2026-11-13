import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installedBy, spawnOptions } from '../../src/commands/update.js';
import { checkAllowed, currentVersion, isNewer, knownHighlights, knownUpdate, readState, updateNotice, type NoticeContext } from '../../src/update/check.js';
import { makeSandbox, removeSandbox, runCli, type Sandbox } from '../helpers/sandbox.js';

const CURRENT = currentVersion();
const DAY = 24 * 60 * 60 * 1000;
const bump = (v: string) => v.replace(/^(\d+)\./, (_, m: string) => `${Number(m) + 1}.`);
const NEXT = bump(CURRENT);

const NOTES = `# Changelog\n\n## ${NEXT} (2026-01-01)\n\n### New\n\n- first\u001b thing, see [the docs](docs/x.md)\n- second thing\n\n## ${CURRENT} (2025-01-01)\n\n- old thing\n`;

// Registry requests land in `calls`; the changelog on GitHub answers `changelog`, or 404.
const registry = (version: string | undefined, changelog?: string) => {
  const calls: string[] = [];
  const rawCalls: string[] = [];
  const fn = (async (url: string) => {
    if (url.startsWith('https://raw.githubusercontent.com/')) {
      rawCalls.push(url);
      return new Response(changelog ?? 'not found', { status: changelog === undefined ? 404 : 200 });
    }
    calls.push(url);
    if (version === undefined) throw new Error('offline');
    return new Response(JSON.stringify({ version }), { status: 200 });
  }) as typeof fetch;
  return { fn, calls, rawCalls };
};

const NOTE_LINES = ['  - first thing, see the docs', '  - second thing'];
const ALL_NOTES = '  all notes: https://github.com/freeleex/codechart/blob/main/CHANGELOG.md';

describe('isNewer', () => {
  it('compares x.y.z releases, never pre-releases or junk', () => {
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isNewer('0.9.0', '0.10.0')).toBe(false);
    expect(isNewer('2.0.0-beta.1', '1.0.0')).toBe(false);
    expect(isNewer('<script>', '1.0.0')).toBe(false);
  });
});

describe('updateNotice', () => {
  let sb: Sandbox;
  beforeEach(() => (sb = makeSandbox('update-notice', { repo: false })));
  afterEach(() => removeSandbox(sb.tmp));

  const ctx = (over: Partial<NoticeContext> = {}): NoticeContext => ({
    cacheDir: join(sb.tmp, 'cache'),
    enabled: true,
    env: {},
    terminal: true,
    now: 1_000_000_000_000,
    fetch: registry(NEXT).fn,
    current: CURRENT,
    ...over,
  });

  it('looks up npm at most once a day, and tells a terminal at most once a day', async () => {
    const reg = registry(NEXT);
    expect(await updateNotice(ctx({ fetch: reg.fn }))).toBe(`codechart ${NEXT} is available (you have ${CURRENT}): run codechart update`);
    expect(await updateNotice(ctx({ fetch: reg.fn, now: 1_000_000_000_000 + 1000 }))).toBeUndefined();
    expect(reg.calls).toEqual(['https://registry.npmjs.org/codechart/latest']);
    expect(await updateNotice(ctx({ fetch: reg.fn, now: 1_000_000_000_000 + DAY }))).toContain('is available');
    expect(reg.calls.length).toBe(2);
  });

  it('adds the highlights under the terminal line, fetched once per newer version', async () => {
    const reg = registry(NEXT, NOTES);
    const line = await updateNotice(ctx({ fetch: reg.fn }));
    expect(line).toBe([`codechart ${NEXT} is available (you have ${CURRENT}): run codechart update`, ...NOTE_LINES, ALL_NOTES].join('\n'));
    expect(reg.rawCalls).toEqual([`https://raw.githubusercontent.com/freeleex/codechart/v${NEXT}/CHANGELOG.md`]);
    expect(knownHighlights(readState(join(sb.tmp, 'cache')), CURRENT, NEXT)?.bullets).toEqual(['first thing, see the docs', 'second thing']);
    await updateNotice(ctx({ fetch: reg.fn, now: 1_000_000_000_000 + DAY }));
    expect(reg.rawCalls.length).toBe(1);
  });

  it('agents keep the one-line message even with highlights', async () => {
    const line = await updateNotice(ctx({ terminal: false, fetch: registry(NEXT, NOTES).fn }));
    expect(line).toBe(`codechart ${NEXT} is available (you have ${CURRENT}). Tell the user once: run \`codechart update\`.`);
  });

  it('no highlights when GitHub fails: the old one-line notice', async () => {
    const reg = registry(NEXT);
    expect(await updateNotice(ctx({ fetch: reg.fn }))).toBe(`codechart ${NEXT} is available (you have ${CURRENT}): run codechart update`);
    expect(reg.rawCalls.length).toBe(1);
  });

  it('ignores stored highlights for another version range or of the wrong shape', () => {
    const span = `${CURRENT}..${NEXT}`;
    expect(knownHighlights({ highlightsFor: `${CURRENT}..9.9.9`, highlights: ['a'] }, CURRENT, NEXT)).toBeUndefined();
    expect(knownHighlights({ highlightsFor: `0.0.1..${NEXT}`, highlights: ['a'] }, CURRENT, NEXT)).toBeUndefined();
    expect(knownHighlights({ highlightsFor: span, highlights: 'a' as unknown as string[] }, CURRENT, NEXT)).toBeUndefined();
    expect(knownHighlights({ highlightsFor: span, highlights: [1, 'ok\u001b[2J', ''] as unknown as string[] }, CURRENT, NEXT)).toEqual({ bullets: ['ok[2J'], more: false });
  });

  it('fetches the highlights again when the installed version changed', async () => {
    const reg = registry(NEXT, NOTES);
    await updateNotice(ctx({ fetch: reg.fn }));
    await updateNotice(ctx({ fetch: reg.fn, now: 1_000_000_000_000 + DAY, current: '0.0.1' }));
    expect(reg.rawCalls.length).toBe(2);
  });

  it('agents get their own once-a-day line asking them to tell the user', async () => {
    await updateNotice(ctx());
    expect(await updateNotice(ctx({ terminal: false }))).toBe(`codechart ${NEXT} is available (you have ${CURRENT}). Tell the user once: run \`codechart update\`.`);
    expect(await updateNotice(ctx({ terminal: false, now: 1_000_000_000_000 + 5000 }))).toBeUndefined();
  });

  it('nothing to say when up to date; offline counts as checked for the day', async () => {
    expect(await updateNotice(ctx({ fetch: registry(CURRENT).fn }))).toBeUndefined();
    const offline = registry(undefined);
    const c = ctx({ fetch: offline.fn, now: 1_000_000_000_000 + DAY });
    expect(await updateNotice(c)).toBeUndefined();
    expect(await updateNotice({ ...c, now: c.now + 1000 })).toBeUndefined();
    expect(offline.calls.length).toBe(1);
    expect(readState(join(sb.tmp, 'cache')).latest).toBe(CURRENT);
  });

  it('off with updateCheck: false, the env vars, in CI and under npx', async () => {
    const reg = registry(NEXT);
    for (const c of [ctx({ enabled: false }), ctx({ env: { CODECHART_NO_UPDATE_CHECK: '1' } }), ctx({ env: { NO_UPDATE_NOTIFIER: '1' } }), ctx({ env: { CI: 'true' } })]) {
      expect(await updateNotice({ ...c, fetch: reg.fn })).toBeUndefined();
    }
    expect(reg.calls).toEqual([]);
    expect(checkAllowed({ enabled: true, env: {} }, '/home/u/.npm/_npx/abc/node_modules/codechart')).toBe(false);
    expect(existsSync(join(sb.tmp, 'cache'))).toBe(false);
  });

  it('knownUpdate reads the last check without going online', async () => {
    await updateNotice(ctx());
    expect(knownUpdate(join(sb.tmp, 'cache'), CURRENT)).toBe(NEXT);
    expect(knownUpdate(join(sb.tmp, 'nothing'), CURRENT)).toBeUndefined();
  });
});

describe('installedBy', () => {
  it('npm global copy, or a hint for other installs', () => {
    expect(installedBy('/usr/lib/node_modules/codechart', '/usr/lib/node_modules')).toEqual({ npm: true });
    expect(installedBy('/home/u/.npm/_npx/1/node_modules/codechart', '/usr/lib/node_modules')).toEqual({ npm: false, hint: 'npx runs the newest codechart already; nothing to update' });
    expect(installedBy('/home/u/.local/share/pnpm/global/5/node_modules/codechart', undefined)).toMatchObject({ hint: 'update it with: pnpm add -g codechart@latest' });
    expect(installedBy('/home/u/.bun/install/global/node_modules/codechart', undefined)).toEqual({ npm: false, hint: 'update it with: bun add -g codechart@latest' });
    expect(installedBy('/home/u/.config/yarn/global/node_modules/codechart', undefined)).toEqual({ npm: false, hint: 'update it with: yarn global add codechart@latest' });
    expect(installedBy('/home/u/src/codechart', '/usr/lib/node_modules')).toMatchObject({ npm: false });
  });
});

describe('spawnOptions', () => {
  it("Windows runs npm from node's folder, so a repo's npm.cmd can't stand in for it", () => {
    expect(spawnOptions('npm', 'win32')).toEqual({ shell: true, cwd: dirname(process.execPath) });
    expect(spawnOptions('npm', 'linux')).toEqual({ shell: false });
    expect(spawnOptions('codechart', 'win32')).toEqual({ shell: false });
  });
});

describe('codechart update', () => {
  let sb: Sandbox;
  beforeEach(() => {
    sb = makeSandbox('update', { htmlOut: true, git: 'init' });
  });
  afterEach(() => removeSandbox(sb.tmp));

  const run = (args: string[], over: Record<string, unknown> = {}) => runCli({ cwd: sb.repo, home: sb.home, ...over }, ['update', ...args]);

  it('--check only reports', async () => {
    const calls: string[][] = [];
    const r = await run(['--check'], { fetch: registry(NEXT).fn, tool: (c: string, a: string[]) => (calls.push([c, ...a]), '') });
    expect(r.out).toBe(`codechart ${NEXT} is available (you have ${CURRENT}): run codechart update\n`);
    expect(calls).toEqual([]);
  });

  it('--check lists the highlights and links the notes', async () => {
    const r = await run(['--check'], { fetch: registry(NEXT, NOTES).fn });
    expect(r.out).toBe([`codechart ${NEXT} is available (you have ${CURRENT}): run codechart update`, ...NOTE_LINES, ALL_NOTES].join('\n') + '\n');
  });

  it('not installed by npm: says how to update instead of running anything', async () => {
    const calls: string[][] = [];
    const r = await run([], { fetch: registry(NEXT, NOTES).fn, tool: (c: string, a: string[]) => (calls.push([c, ...a]), '/somewhere/else/node_modules\n') });
    expect(r.out).toContain(`codechart ${NEXT} is available (you have ${CURRENT}), but it isn't npm's global copy`);
    expect(r.out).toContain(ALL_NOTES);
    expect(calls).toEqual([['npm', 'root', '-g']]);
  });

  it('installed by npm: installs the exact version, then lets the new one refresh the skills', async () => {
    const npmRoot = join(sb.tmp, 'npm-global');
    mkdirSync(npmRoot);
    symlinkSync(join(import.meta.dirname, '..', '..'), join(npmRoot, 'codechart'), 'junction');
    const calls: string[][] = [];
    const tool = (c: string, a: string[]) => (calls.push([c, ...a]), a[0] === 'root' ? `${npmRoot}\n` : '');
    const r = await run([], { fetch: registry(NEXT, NOTES).fn, tool });
    expect(r.out).toContain(`Updating codechart ${CURRENT} → ${NEXT}: npm install -g codechart@${NEXT}\n${NOTE_LINES.join('\n')}\n${ALL_NOTES}\n`);
    expect(r.out).toContain(`codechart ${NEXT} installed. What changed: https://github.com/freeleex/codechart/blob/main/CHANGELOG.md`);
    expect(calls).toEqual([
      ['npm', 'root', '-g'],
      ['npm', 'install', '-g', `codechart@${NEXT}`],
      ['codechart', 'update', '--skills-only'],
    ]);
  });

  it('up to date: says so and refreshes an older skill copy and reminder line', async () => {
    const skill = join(sb.home, '.claude', 'skills', 'codechart');
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, 'SKILL.md'), '---\nname: codechart\n---\nold\n');
    writeFileSync(join(sb.home, '.claude', 'CLAUDE.md'), 'mine\n<!-- codechart -->\nold reminder\n<!-- /codechart -->\n');
    mkdirSync(join(sb.home, '.gemini'), { recursive: true });
    writeFileSync(join(sb.home, '.gemini', 'GEMINI.md'), 'no reminder here\n');
    const r = await run([], { fetch: registry(CURRENT).fn });
    expect(r.out).toContain(`codechart ${CURRENT} is the newest version.`);
    expect(r.out).toContain(`updated for Claude Code, Cursor, OpenCode, Goose, Amp: ${skill}`);
    expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toBe(readFileSync('skills/codechart/SKILL.md', 'utf8'));
    expect(readFileSync(join(sb.home, '.claude', 'CLAUDE.md'), 'utf8')).toContain('use the codechart skill');
    expect(readFileSync(join(sb.home, '.gemini', 'GEMINI.md'), 'utf8')).toBe('no reminder here\n');
    expect(existsSync(join(sb.home, '.gemini', 'skills'))).toBe(false);
  });

  it('refreshes a copy installed with install-skill --dir', async () => {
    const own = join(sb.tmp, 'my-skills');
    expect((await runCli({ cwd: sb.repo, home: sb.home }, ['install-skill', '--dir', own])).out).toContain('installed for your folder');
    writeFileSync(join(own, 'codechart', 'SKILL.md'), '---\nname: codechart\n---\nold\n');
    const r = await run([], { fetch: registry(CURRENT).fn });
    expect(r.out).toContain(`updated for your folder: ${join(own, 'codechart')}`);
    expect(readFileSync(join(own, 'codechart', 'SKILL.md'), 'utf8')).toBe(readFileSync('skills/codechart/SKILL.md', 'utf8'));
  });

  it('npm unreachable: an error, nothing changed', async () => {
    const r = await run([], { fetch: registry(undefined).fn });
    expect(r.code).toBe(1);
    expect(r.err).toContain("couldn't reach the npm registry");
  });
});

describe('notices from other commands', () => {
  let sb: Sandbox;
  const keys = ['CODECHART_NO_UPDATE_CHECK', 'CI'] as const;
  let saved: Partial<Record<(typeof keys)[number], string>>;
  beforeEach(() => {
    sb = makeSandbox('notice-cli', { htmlOut: true, git: 'init' });
    saved = {};
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of keys) if (saved[k] !== undefined) process.env[k] = saved[k];
    removeSandbox(sb.tmp);
  });

  const spec = { title: 'Big map', kind: 'plan', nodes: Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, label: `node${i}`, kind: 'other', status: 'new', layer: 'l' })), edges: [] };

  it('an agent run gets one stderr line a day; the HTML page header shows it too', async () => {
    writeFileSync(join(sb.tmp, 'spec.json'), JSON.stringify(spec));
    const opts = { cwd: sb.repo, home: sb.home, isTTY: false, updateCheck: true, fetch: registry(NEXT).fn };
    const first = await runCli(opts, ['render', join(sb.tmp, 'spec.json'), '--output', 'cli']);
    expect(first.err).toContain(`codechart ${NEXT} is available`);
    const second = await runCli(opts, ['render', join(sb.tmp, 'spec.json'), '--output', 'web']);
    expect(second.err).not.toContain('is available');
    const page = readFileSync(fileURLToPath(second.out.match(/file:\/\/\S+\.html/)![0]), 'utf8');
    expect(page).toContain(`codechart ${NEXT} is out: run <code>codechart update</code>`);
  });

  it('the HTML header tooltip lists the cached highlights, escaped', async () => {
    writeFileSync(join(sb.tmp, 'spec.json'), JSON.stringify(spec));
    const fetch = registry(NEXT, `## ${NEXT} (2026-01-01)\n\n- fix <b>bold</b> & "quotes"\n`).fn;
    const opts = { cwd: sb.repo, home: sb.home, isTTY: false, updateCheck: true, fetch };
    await runCli(opts, ['render', join(sb.tmp, 'spec.json'), '--output', 'cli']);
    const second = await runCli(opts, ['render', join(sb.tmp, 'spec.json'), '--output', 'web']);
    const page = readFileSync(fileURLToPath(second.out.match(/file:\/\/\S+\.html/)![0]), 'utf8');
    expect(page).toContain('title="A newer codechart is out\n- fix &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quotes&quot;"');
  });

  it('updateCheck: false in the global config keeps it quiet and offline', async () => {
    writeFileSync(join(sb.home, '.config', 'codechart', 'config.yaml'), `web:\n  outDir: ${sb.out}\nupdateCheck: false\n`);
    const reg = registry(NEXT);
    const r = await runCli({ cwd: sb.repo, home: sb.home, isTTY: false, updateCheck: true, fetch: reg.fn }, ['config']);
    expect(r.err).not.toContain('is available');
    expect(r.out).toContain(`updateCheck: false  (global: ${join(sb.home, '.config', 'codechart', 'config.yaml')}; global-only)`);
    expect(reg.calls).toEqual([]);
  });
});
