import { writeFileSync } from 'node:fs';
import { buildClient, CLIENT_OUTPUT } from './client-build.js';

writeFileSync(CLIENT_OUTPUT, buildClient());
