import { writeFileSync } from 'node:fs';
import type { ProgramOptions } from '../../src/program.js';

export const printTarget = (args: string[]): string => args.find((a) => a.startsWith('--print-to-pdf='))!.slice('--print-to-pdf='.length);

/** A browser that is "installed" and prints a minimal PDF; `calls` records each run. */
export function fakeBrowser(calls: { browser: string; args: string[] }[] = []): NonNullable<ProgramOptions['pdf']> {
  return {
    find: () => '/fake/chrome',
    run: async (browser, args) => {
      calls.push({ browser, args });
      writeFileSync(printTarget(args), '%PDF-1.7\nfake\n');
    },
  };
}
