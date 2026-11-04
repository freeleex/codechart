import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Git-heavy tests take 6-11s on Windows runners.
  test: { include: ['tests/**/*.test.ts'], testTimeout: process.platform === 'win32' ? 30_000 : 5_000 },
});
