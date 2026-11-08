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

/** The JSON in a spec file, or in `stdin` for '-'; the error names where it came from. */
export async function readSpecJson(arg: string, cwd: string, stdin: () => Promise<string>): Promise<unknown> {
  const source = arg === '-' ? 'stdin' : resolve(cwd, arg);
  try {
    const text = arg === '-' ? await stdin() : readSpecFile(source);
    if (Buffer.byteLength(text) > MAX_SPEC_BYTES) throw new Error(TOO_BIG);
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${source}: ${(e as Error).message}`);
  }
}
