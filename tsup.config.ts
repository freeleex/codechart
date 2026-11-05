import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts', server: 'src/opencode/server.ts' },
  format: ['esm'],
  target: 'node22',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
});
