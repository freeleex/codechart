import { Command } from 'commander';
import { configJsonSchema } from '../config/schema.js';
import type { CommandOptions } from '../program.js';
import { flowJsonSchema } from '../spec/flow.js';
import { specJsonSchema } from '../spec/schema.js';

export function schemaCommand(opts: CommandOptions): Command {
  return new Command('schema')
    .description('print the spec JSON schema, the flow spec schema with --flow, or the config file schema with --config')
    .option('--config', 'print the config file schema instead')
    .option('--flow', 'print the flow spec schema instead')
    .action((o: { config?: boolean; flow?: boolean }) => {
      const schema = o.config ? configJsonSchema() : o.flow ? flowJsonSchema() : specJsonSchema();
      opts.stdout(JSON.stringify(schema, null, 2) + '\n');
    });
}
