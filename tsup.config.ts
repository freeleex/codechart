import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts', server: 'src/opencode/server.ts' },
  format: ['esm'],
  target: 'node22',
  clean: true,
  // The package ships exactly dist/cli.js and dist/server.js (scripts/check-pack.mjs).
  splitting: false,
  banner: { js: '#!/usr/bin/env node' },
});
