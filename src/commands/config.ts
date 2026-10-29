import { Command } from 'commander';
import { GLOBAL_ONLY, loadConfigWithSources, type ConfigWithSources } from '../config/load.js';
import type { CommandOptions } from '../program.js';
import { escapeJsonControls } from '../render/strip.js';
import { flat } from '../render/terminal/wrap.js';

function formatText({ config, sources, ruleSources }: ConfigWithSources): string {
  const values: Record<string, unknown> = {
    ...Object.fromEntries(Object.entries(config.defaults).map(([k, v]) => [`defaults.${k}`, v])),
    ...Object.fromEntries(Object.entries(config.web).map(([k, v]) => [`web.${k}`, v])),
    useBuiltinRules: config.useBuiltinRules,
  };
  if (!config.useBuiltinRules) values['defaults.flows'] = 'inactive (built-in rules off)';
  const globalOnly = (key: string) => ((GLOBAL_ONLY as readonly string[]).includes(key) ? '; global-only' : '');
  const lines = Object.entries(values).map(([key, value]) => `${key}: ${value}  (${sources[key]}${globalOnly(key)})`);
  lines.push('rules (evaluation order):');
  config.rules.forEach((rule, i) => {
    const match = rule.paths ? `paths: ${rule.paths.join(', ')}` : `when: ${JSON.stringify(rule.when)}`;
    const diagram = rule.diagram ?? 'map';
    const context = diagram === 'map' ? `  context: ${rule.context ?? config.defaults.context}` : '';
    lines.push(`  ${rule.name}  ${diagram}  ${match}  ${rule.output ?? config.defaults.output}${context}  (${ruleSources[i]})`);
  });
  return lines.map(flat).join('\n') + '\n';
}

export function configCommand(opts: CommandOptions): Command {
  return new Command('config')
    .description('print the config in effect and where each value comes from')
    .option('--json', 'print as JSON')
    .action((o: { json?: boolean }) => {
      try {
        const result = loadConfigWithSources({
          cwd: opts.cwd ?? process.cwd(),
          home: opts.home,
          env: opts.env,
          warn: (l) => opts.stderr(`codechart: ${l}\n`),
        });
        opts.stdout(o.json ? escapeJsonControls(JSON.stringify(result, null, 2)) + '\n' : formatText(result));
      } catch (e) {
        opts.stderr((e as Error).message.split('\n').map((l) => `codechart: ${l}\n`).join(''));
        process.exitCode = 1;
      }
    });
}
