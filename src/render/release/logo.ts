import { realpathSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { readRegularBytes } from '../../read-regular.js';

const MAX_LOGO_BYTES = 200 * 1024;
const TYPES: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png' };
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const escapes = (rel: string): boolean => rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);

function realInside(root: string, path: string): string | undefined {
  if (isAbsolute(path) || escapes(relative(root, resolve(root, path)))) return undefined;
  const real = realpathSync(resolve(root, path));
  return escapes(relative(realpathSync(root), real)) ? undefined : real;
}

function matchesType(bytes: Buffer, ext: string): boolean {
  return ext === '.png' ? bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) : /<svg[\s>]/i.test(bytes.toString('utf8'));
}

/** The logo at `path` (relative to the repo root) as a `data:` URI, or why it can't be used. An SVG in an `<img>` runs no script. */
export function loadLogo(root: string, path: string): { uri: string } | { error: string } {
  const ext = extname(path).toLowerCase();
  const type = TYPES[ext];
  if (!type) return { error: 'must be an .svg or .png file' };
  try {
    const real = realInside(root, path);
    if (!real) return { error: 'must be a path inside the repo' };
    let refused: string | undefined;
    const bytes = readRegularBytes(real, (st) => {
      if (!st.isFile()) refused = 'is not a regular file';
      else if (st.size > MAX_LOGO_BYTES) refused = 'is over 200 KB';
      return refused === undefined;
    });
    if (refused !== undefined || !bytes) return { error: refused ?? 'could not be read' };
    if (!matchesType(bytes, ext)) return { error: `is not a real ${ext.slice(1).toUpperCase()}` };
    return { uri: `data:${type};base64,${bytes.toString('base64')}` };
  } catch (e) {
    return { error: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'was not found' : 'could not be read' };
  }
}
