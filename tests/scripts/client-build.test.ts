import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildClient, CLIENT_OUTPUT } from '../../scripts/client-build.js';

describe('page client script', () => {
  it('committed file matches its TypeScript source (run npm run gen:client)', () => {
    expect(readFileSync(CLIENT_OUTPUT, 'utf8')).toBe(buildClient());
  });
});
