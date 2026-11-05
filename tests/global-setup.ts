import { build } from 'tsup';

// install-skill copies dist/server.js; tests must see this checkout's build, not a stale or missing one.
export default async function setup() {
  await build({ config: 'tsup.config.ts', silent: true });
}
