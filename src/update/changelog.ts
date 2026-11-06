import { stripInvisible } from '../render/strip.js';
import { isNewer } from './check.js';

export const NOTES_URL = 'https://github.com/freeleex/codechart/blob/main/CHANGELOG.md';
const RAW = 'https://raw.githubusercontent.com/freeleex/codechart';
const VERSION = /^\d+\.\d+\.\d+$/;
const MAX_BYTES = 256 * 1024;
const MAX_CHARS = 200;

export interface Highlights {
  bullets: string[];
  /** Bullets were left out to stay under the cap. */
  more: boolean;
}

interface Release {
  version: string;
  bullets: string[];
}

/** The versions of a changelog, in file order, each with its top-level `- ` bullets. */
export function parseChangelog(md: string): Release[] {
  const releases: Release[] = [];
  for (const line of md.split(/\r?\n/)) {
    const heading = /^## (\d+\.\d+\.\d+)(?:\s|$)/.exec(line);
    if (heading) releases.push({ version: heading[1]!, bullets: [] });
    else if (line.startsWith('- ') && releases.length) releases.at(-1)!.bullets.push(line.slice(2).trim());
  }
  return releases;
}

/** One bullet as safe terminal text: no control characters, links reduced to their text, at most 200 characters. */
export function cleanBullet(s: string): string {
  const text = stripInvisible(s)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();
  const chars = [...text];
  return chars.length > MAX_CHARS ? `${chars.slice(0, MAX_CHARS - 1).join('')}…` : text;
}

/** The bullets of every release after `current` up to `latest`, newest first, at most `max`. */
export function highlights(md: string, current: string, latest: string, max = 5): Highlights {
  const all = parseChangelog(md)
    .filter((r) => isNewer(r.version, current) && !isNewer(r.version, latest))
    .sort((a, b) => (isNewer(a.version, b.version) ? -1 : 1))
    .flatMap((r) => r.bullets.map(cleanBullet))
    .filter(Boolean);
  return { bullets: all.slice(0, max), more: all.length > max };
}

/** The body as text, or undefined once it passes MAX_BYTES (the download stops there). */
async function readCapped(body: ReadableStream<Uint8Array>): Promise<string | undefined> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    // Leaving the loop cancels the stream.
    if (size > MAX_BYTES) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The release notes of `latest` for the versions after `current`, or undefined when GitHub doesn't answer in time. */
export async function fetchHighlights(fetchFn: typeof fetch, current: string, latest: string, timeoutMs: number): Promise<Highlights | undefined> {
  if (!VERSION.test(latest)) return undefined;
  try {
    const res = await fetchFn(`${RAW}/v${latest}/CHANGELOG.md`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok || !res.body || Number(res.headers.get('content-length')) > MAX_BYTES) return undefined;
    const md = await readCapped(res.body);
    if (md === undefined) return undefined;
    const found = highlights(md, current, latest);
    return found.bullets.length ? found : undefined;
  } catch {
    return undefined;
  }
}

/** The lines under the "is available" line: the highlights, then where to read the rest. */
export function notesLines(h: Highlights | undefined): string[] {
  if (!h?.bullets.length) return [];
  return [...h.bullets.map((b) => `  - ${b}`), ...(h.more ? ['  - …and more'] : []), `  all notes: ${NOTES_URL}`];
}
