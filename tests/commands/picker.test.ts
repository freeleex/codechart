import { describe, expect, it } from 'vitest';
import { type Key, type PickerState, pickerLines, pickerStep } from '../../src/commands/picker.js';

const start: PickerState = { cursor: 0, checked: [true, true, true] };
const press = (s: PickerState, ...keys: Key[]) => keys.reduce(pickerStep, s);

describe('picker keys', () => {
  it('arrows and j/k move the cursor and wrap', () => {
    expect(press(start, { name: 'down' }, { name: 'down' }).cursor).toBe(2);
    expect(press(start, { name: 'down' }, { name: 'down' }, { name: 'down' }).cursor).toBe(0);
    expect(press(start, { name: 'up' }).cursor).toBe(2);
    expect(press(start, { name: 'j' }, { name: 'k' }).cursor).toBe(0);
  });

  it('space toggles the item under the cursor', () => {
    expect(press(start, { name: 'down' }, { name: 'space' }).checked).toEqual([true, false, true]);
  });

  it('a selects all, or clears all when everything is selected', () => {
    expect(press(start, { name: 'a' }).checked).toEqual([false, false, false]);
    expect(press(start, { name: 'space' }, { name: 'a' }).checked).toEqual([true, true, true]);
  });

  it('Enter confirms; Esc and Ctrl-C cancel; other keys do nothing', () => {
    expect(press(start, { name: 'return' }).done).toBe('ok');
    expect(press(start, { name: 'escape' }).done).toBe('cancel');
    expect(press(start, { name: 'c', ctrl: true }).done).toBe('cancel');
    expect(press(start, { name: 'x' })).toEqual(start);
  });
});

describe('picker drawing', () => {
  it('marks the cursor and checked items, aligns hints, ends with the key help', () => {
    const lines = pickerLines('Pick:', [{ label: 'Codex', hint: '~/.agents/skills' }, { label: 'Gemini CLI', hint: '~/.gemini/skills' }], {
      cursor: 1,
      checked: [false, true],
    });
    expect(lines[0]).toBe('Pick:');
    expect(lines[1]).toBe('  ◯ Codex       \x1b[2m~/.agents/skills\x1b[0m');
    expect(lines[2]).toBe('❯ ◉ Gemini CLI  \x1b[2m~/.gemini/skills\x1b[0m');
    expect(lines[3]).toContain('Space toggle');
  });
});
