import { Command } from 'commander';
import { configJsonSchema } from '../config/schema.js';
import type { CommandOptions } from '../program.js';
import { businessSpecJsonSchema } from '../spec/business.js';
import { flowJsonSchema } from '../spec/flow.js';
import { releaseSpecJsonSchema } from '../spec/release.js';
import { specJsonSchema } from '../spec/schema.js';

export function schemaCommand(opts: CommandOptions): Command {
  return new Command('schema')
    .description('print the spec JSON schema, the flow spec schema with --flow, the business map schema with --business, the release map schema with --release, or the config file schema with --config')
    .option('--config', 'print the config file schema instead')
    .option('--flow', 'print the flow spec schema instead')
    .option('--business', 'print the business map spec schema instead')
    .option('--release', 'print the release map spec schema instead')
    .option('--explain', 'with --business: the schema of a business page that explains how an area works today')
    .action((o: { config?: boolean; flow?: boolean; business?: boolean; release?: boolean; explain?: boolean }, cmd: Command) => {
      if ([o.config, o.flow, o.business, o.release].filter(Boolean).length > 1) cmd.error('--config, --flow, --business and --release are mutually exclusive', { exitCode: 2 });
      if (o.explain && !o.business) cmd.error('--explain only applies to --business', { exitCode: 2 });
      const schema = o.config ? configJsonSchema() : o.flow ? flowJsonSchema() : o.business ? businessSpecJsonSchema(o.explain) : o.release ? releaseSpecJsonSchema() : specJsonSchema();
      opts.stdout(JSON.stringify(schema, null, 2) + '\n');
    });
}
