import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Works from both src/ (tests) and the bundled dist/.
export function packageFile(relative: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('package root not found');
    dir = parent;
  }
  return join(dir, relative);
}
