import { constants, closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAX_SPEC_BYTES } from '../spec/shared.js';

export class InvalidSpec extends Error {
  constructor(readonly errors: string[]) {
    super('invalid spec');
  }
}

export const TOO_BIG = 'spec is larger than 2 MB';

function readSpecFile(file: string): string {
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    if (!fstatSync(fd).isFile()) throw new Error('not a regular file');
    const buf = Buffer.alloc(MAX_SPEC_BYTES + 1);
    let n = 0;
    for (let r = 1; r > 0 && n < buf.length; n += r) r = readSync(fd, buf, n, buf.length - n, null);
    if (n > MAX_SPEC_BYTES) throw new Error(TOO_BIG);
    return buf.toString('utf8', 0, n);
  } finally {
    closeSync(fd);
  }
}

const named = (source: string, e: unknown): Error => new Error(`${source}: ${(e as NodeJS.ErrnoException).code === 'ENOENT' ? 'no such file' : (e as Error).message}`);

/** The JSON in a spec file, or in `stdin` for '-'; the error names where it came from. */
export async function readSpecJson(arg: string, cwd: string, stdin: () => Promise<string>): Promise<unknown> {
  const source = arg === '-' ? 'stdin' : resolve(cwd, arg);
  let text: string;
  try {
    text = arg === '-' ? await stdin() : readSpecFile(source);
  } catch (e) {
    throw named(source, e);
  }
  if (Buffer.byteLength(text) > MAX_SPEC_BYTES) throw named(source, new Error(TOO_BIG));
  if (text.trim() === '') throw new Error(arg === '-' ? 'stdin is empty: pipe the spec JSON in' : `${source}: file is empty`);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw named(source, e);
  }
}
