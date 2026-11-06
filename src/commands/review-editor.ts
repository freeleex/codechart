import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';

const VI_FAMILY = new Set(['vi', 'vim', 'nvim', 'gvim', 'mvim']);

// Constant strings, no user text. macOS's system vimrc turns syntax off, so a bare vi shows the document in one colour.
const VI_ARGS =
  "-c 'syntax on' -c 'set ft=diff' -c 'syn match codechartNote /^>.*/' -c 'syn match codechartHead /^##.*/' " +
  "-c 'hi codechartNote ctermfg=black ctermbg=yellow guifg=black guibg=yellow' -c 'hi link codechartHead Title'";

/** The editor command, with the highlighting arguments added when the program is a vi-family editor; others unchanged. */
export function withEditorArgs(editor: string): string {
  const program = basename(editor.trim().split(/\s+/)[0] ?? '');
  return VI_FAMILY.has(program) ? `${editor} ${VI_ARGS}` : editor;
}

/** `sh -c` so an editor setting with arguments (`code --wait`) works; returns the exit status. */
export const runEditor = (command: string, file: string): number =>
  spawnSync('sh', ['-c', `${withEditorArgs(command)} "$1"`, 'sh', file], { stdio: 'inherit' }).status ?? 1;
