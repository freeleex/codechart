import { writeFileSync } from 'node:fs';
import { configJsonSchema } from '../src/config/schema.js';

writeFileSync('config.schema.json', JSON.stringify(configJsonSchema(), null, 2) + '\n');
