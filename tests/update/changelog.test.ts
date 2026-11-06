import { describe, expect, it } from 'vitest';
import { cleanBullet, fetchHighlights, highlights, notesLines, parseChangelog } from '../../src/update/changelog.js';

const MD = `# Changelog

Intro with a - dash.

## 0.3.0 (2026-11-03)

### New

- three-a
- three-b

## 0.2.0 (2026-11-02)

### Fixed

- two-a
  continuation is ignored
- two-b

## 0.1.0 (2026-11-01)

- one-a
`;

const answering = (res: Response | Error) => {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    if (res instanceof Error) throw res;
    return res;
  }) as typeof fetch;
  return { fn, calls };
};

describe('parseChangelog', () => {
  it('lists versions in file order with their top-level bullets only', () => {
    expect(parseChangelog(MD)).toEqual([
      { version: '0.3.0', bullets: ['three-a', 'three-b'] },
      { version: '0.2.0', bullets: ['two-a', 'two-b'] },
      { version: '0.1.0', bullets: ['one-a'] },
    ]);
  });
});

describe('highlights', () => {
  it('takes versions after current up to latest, newest first', () => {
    expect(highlights(MD, '0.1.0', '0.3.0')).toEqual({ bullets: ['three-a', 'three-b', 'two-a', 'two-b'], more: false });
    expect(highlights(MD, '0.1.0', '0.2.0').bullets).toEqual(['two-a', 'two-b']);
    expect(highlights(MD, '0.3.0', '0.3.0')).toEqual({ bullets: [], more: false });
  });

  it('is newest first whatever the file order', () => {
    const shuffled = '## 0.1.0 (a)\n- old\n## 0.2.0 (b)\n- new\n';
    expect(highlights(shuffled, '0.0.1', '0.2.0').bullets).toEqual(['new', 'old']);
  });

  it('cuts at max and says so', () => {
    expect(highlights(MD, '0.1.0', '0.3.0', 3)).toEqual({ bullets: ['three-a', 'three-b', 'two-a'], more: true });
    expect(highlights(MD, '0.1.0', '0.3.0', 4).more).toBe(false);
  });
});

describe('cleanBullet', () => {
  it('drops escape and other control characters, so a changelog cannot drive the terminal', () => {
    expect(cleanBullet('a\u001b[31mred\u001b]52;c;eA==\u0007\u009b2Jb\u0000c​d')).toBe('a[31mred]52;c;eA==2Jbcd');
  });

  it('keeps the text of links and drops their targets', () => {
    expect(cleanBullet('see [docs/pr-maps.md](docs/pr-maps.md) and [site](https://e.com/a) now')).toBe('see docs/pr-maps.md and site now');
  });

  it('caps long lines', () => {
    const out = cleanBullet('x'.repeat(500));
    expect([...out].length).toBe(200);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('fetchHighlights', () => {
  it('reads the CHANGELOG of the latest tag', async () => {
    const r = answering(new Response(MD));
    expect(await fetchHighlights(r.fn, '0.2.0', '0.3.0', 1000)).toEqual({ bullets: ['three-a', 'three-b'], more: false });
    expect(r.calls).toEqual(['https://raw.githubusercontent.com/freeleex/codechart/v0.3.0/CHANGELOG.md']);
  });

  it('is undefined when it fails, whatever the failure', async () => {
    expect(await fetchHighlights(answering(new Response('no', { status: 404 })).fn, '0.2.0', '0.3.0', 1000)).toBeUndefined();
    expect(await fetchHighlights(answering(new Error('offline')).fn, '0.2.0', '0.3.0', 1000)).toBeUndefined();
    expect(await fetchHighlights(answering(new Response('x'.repeat(256 * 1024 + 1))).fn, '0.2.0', '0.3.0', 1000)).toBeUndefined();
    expect(await fetchHighlights(answering(new Response(MD, { headers: { 'content-length': String(1 << 30) } })).fn, '0.2.0', '0.3.0', 1000)).toBeUndefined();
    const endless = new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(new Uint8Array(64 * 1024)) });
    expect(await fetchHighlights(answering(new Response(endless)).fn, '0.2.0', '0.3.0', 1000)).toBeUndefined();
    expect(await fetchHighlights(answering(new Response('é'.repeat(130 * 1024))).fn, '0.2.0', '0.3.0', 1000)).toBeUndefined();
    expect(await fetchHighlights(answering(new Response('# nothing useful\n')).fn, '0.2.0', '0.3.0', 1000)).toBeUndefined();
  });

  it('never builds a URL from a version that is not x.y.z', async () => {
    const r = answering(new Response(MD));
    expect(await fetchHighlights(r.fn, '0.2.0', '0.3.0/../../x', 1000)).toBeUndefined();
    expect(await fetchHighlights(r.fn, '0.2.0', '1.0.0-beta.1', 1000)).toBeUndefined();
    expect(r.calls).toEqual([]);
  });
});

describe('notesLines', () => {
  it('lists the bullets then the link; nothing without highlights', () => {
    expect(notesLines({ bullets: ['a', 'b'], more: false })).toEqual(['  - a', '  - b', '  all notes: https://github.com/freeleex/codechart/blob/main/CHANGELOG.md']);
    expect(notesLines({ bullets: ['a'], more: true })).toContain('  - …and more');
    expect(notesLines(undefined)).toEqual([]);
    expect(notesLines({ bullets: [], more: false })).toEqual([]);
  });
});
