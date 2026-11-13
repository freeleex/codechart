import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultEditor, editorInvocation, withEditorArgs } from '../../src/commands/review-editor.js';
import { makeSandbox, removeSandbox, runCli } from '../helpers/sandbox.js';

const SYNTAX =
  '-c "syntax on" -c "set ft=diff" -c "syn match codechartNote /^ *>.*/" -c "syn match codechartHead /^##.*/" -c "hi codechartNote ctermfg=black ctermbg=yellow guifg=black guibg=yellow" -c "hi link codechartHead Title"';

describe('withEditorArgs', () => {
  it.each(['vi', 'vim', 'nvim', 'gvim', 'mvim', '/usr/bin/vim', '/opt/homebrew/bin/nvim', '"C:\\Program Files\\Vim\\vim91\\gvim.exe"', 'VIM.EXE'])('%s gets the highlighting arguments', (editor) => {
    expect(withEditorArgs(editor)).toBe(`${editor} ${SYNTAX}`);
  });

  it('keeps the user\'s own arguments first', () => {
    expect(withEditorArgs('nvim -p')).toBe(`nvim -p ${SYNTAX}`);
  });

  it.each(['code --wait', 'nano', 'emacs -nw', 'hx', 'subl -w', 'vimr', 'view', '/usr/bin/nano'])('%s is left as it is', (editor) => {
    expect(withEditorArgs(editor)).toBe(editor);
  });
});

describe('editorInvocation', () => {
  it('posix: sh -c with the file as an argument, never spliced in', () => {
    expect(editorInvocation('darwin', 'code --wait', '/tmp/x/a.diff')).toEqual(['sh', ['-c', 'code --wait "$1"', 'sh', '/tmp/x/a.diff'], { stdio: 'inherit' }]);
    expect(editorInvocation('linux', 'vim', '/tmp/x/a.diff')[1]).toEqual(['-c', `vim ${SYNTAX} "$1"`, 'sh', '/tmp/x/a.diff']);
  });

  it('win32: one cmd.exe line with the path in double quotes, no sh', () => {
    const file = 'C:\\Users\\me\\AppData\\Local\\Temp\\codechart-review-AbC123\\orders.diff';
    expect(editorInvocation('win32', 'notepad', file)).toEqual([`notepad "${file}"`, [], { stdio: 'inherit', shell: true }]);
    expect(editorInvocation('win32', 'nvim -p', file)[0]).toBe(`nvim -p ${SYNTAX} "${file}"`);
  });

  it('the default editor is notepad on Windows, vi elsewhere', () => {
    expect(defaultEditor('win32')).toBe('notepad');
    expect(defaultEditor('darwin')).toBe('vi');
    expect(defaultEditor('linux')).toBe('vi');
  });
});

// The stand-in editors are sh scripts.
describe.skipIf(process.platform === 'win32')('the editor the review command starts', () => {
  let tmp: string;
  let home: string;
  let repo: string;
  beforeEach(() => {
    ({ tmp, home, repo } = makeSandbox('review-editor', { git: 'dir', htmlOut: true }));
  });
  afterEach(() => removeSandbox(tmp));

  const spec = { title: 'Invoices for paid orders', kind: 'plan', nodes: [{ id: 'a', label: 'a', kind: 'other', status: 'new', layer: 'l' }], edges: [] };

  /** A stand-in editor that records what it was started with. */
  function fakeEditor(name: string): { path: string; log: string } {
    const path = join(tmp, name);
    const log = join(tmp, `${name}.log`);
    writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\n`);
    chmodSync(path, 0o755);
    return { path, log };
  }

  async function review(editor: string) {
    writeFileSync(join(tmp, 'spec.json'), JSON.stringify(spec));
    await runCli({ cwd: repo, home, isTTY: false }, ['render', join(tmp, 'spec.json'), '--output', 'cli']);
    return runCli({ cwd: repo, home, isTTY: false, env: { VISUAL: editor } }, ['review']);
  }

  it('a vi-family editor gets the highlighting arguments, then the file named after the map with .diff', async () => {
    const ed = fakeEditor('vim');
    await review(ed.path);
    const args = readFileSync(ed.log, 'utf8').trimEnd().split('\n');
    expect(args.slice(0, 4)).toEqual(['-c', 'syntax on', '-c', 'set ft=diff']);
    expect(args.at(-2)).toBe('hi link codechartHead Title');
    expect(args.at(-1)).toMatch(/[\\/]codechart-review-[^\\/]+[\\/]invoices-for-paid-orders\.diff$/);
    expect(existsSync(args.at(-1)!)).toBe(false);
  });

  it('another editor gets only the file, which ends in .diff', async () => {
    const ed = fakeEditor('nano');
    await review(ed.path);
    const args = readFileSync(ed.log, 'utf8').trimEnd().split('\n');
    expect(args).toEqual([expect.stringMatching(/[\\/]invoices-for-paid-orders\.diff$/)]);
  });
});
