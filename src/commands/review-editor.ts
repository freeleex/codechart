import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { win32 } from 'node:path';

const VI_FAMILY = new Set(['vi', 'vim', 'nvim', 'gvim', 'mvim']);

// Constant strings, no user text; double quotes because cmd.exe does not treat single quotes as quotes.
// macOS's system vimrc turns syntax off, so a bare vi shows the document in one colour.
const VI_ARGS =
  '-c "syntax on" -c "set ft=diff" -c "syn match codechartNote /^>.*/" -c "syn match codechartHead /^##.*/" ' +
  '-c "hi codechartNote ctermfg=black ctermbg=yellow guifg=black guibg=yellow" -c "hi link codechartHead Title"';

/** The editor when neither `$VISUAL` nor `$EDITOR` is set. */
export const defaultEditor = (platform: NodeJS.Platform = process.platform): string => (platform === 'win32' ? 'notepad' : 'vi');

/** The editor command, with the highlighting arguments added when the program is a vi-family editor; others unchanged. */
export function withEditorArgs(editor: string): string {
  const first = /^\s*(?:"([^"]*)"|(\S+))/.exec(editor);
  const program = win32.basename(first?.[1] ?? first?.[2] ?? '').replace(/\.exe$/i, '').toLowerCase();
  return VI_FAMILY.has(program) ? `${editor} ${VI_ARGS}` : editor;
}

/**
 * How to start the editor on `file`, so an editor setting with arguments (`code --wait`) works.
 * Windows has no `sh`: cmd.exe runs the line, with the path in double quotes. That is safe because the path is ours
 * (temp folder plus a `[a-z0-9-]` name) and a Windows path cannot contain `"`.
 */
export function editorInvocation(platform: NodeJS.Platform, command: string, file: string): [string, string[], SpawnSyncOptions] {
  const line = withEditorArgs(command);
  if (platform === 'win32') return [`${line} "${file}"`, [], { stdio: 'inherit', shell: true }];
  return ['sh', ['-c', `${line} "$1"`, 'sh', file], { stdio: 'inherit' }];
}

/** Runs the editor and returns its exit status. */
export function runEditor(command: string, file: string, platform: NodeJS.Platform = process.platform): number {
  const [cmd, args, options] = editorInvocation(platform, command, file);
  return spawnSync(cmd, args, options).status ?? 1;
}
