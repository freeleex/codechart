import { emitKeypressEvents } from 'node:readline';

export interface PickerItem {
  label: string;
  hint: string;
}

export interface PickerState {
  cursor: number;
  checked: boolean[];
  done?: 'ok' | 'cancel';
}

export interface Key {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
}

export function pickerStep(s: PickerState, key: Key): PickerState {
  const n = s.checked.length;
  switch (key.ctrl ? `ctrl-${key.name}` : (key.name ?? key.sequence)) {
    case 'up':
    case 'k':
      return { ...s, cursor: (s.cursor + n - 1) % n };
    case 'down':
    case 'j':
      return { ...s, cursor: (s.cursor + 1) % n };
    case 'space':
      return { ...s, checked: s.checked.map((c, i) => (i === s.cursor ? !c : c)) };
    case 'a': {
      const all = s.checked.every(Boolean);
      return { ...s, checked: s.checked.map(() => !all) };
    }
    case 'return':
      return { ...s, done: 'ok' };
    case 'escape':
    case 'ctrl-c':
      return { ...s, done: 'cancel' };
    default:
      return s;
  }
}

export function pickerLines(title: string, items: PickerItem[], s: PickerState): string[] {
  const width = Math.max(...items.map((i) => i.label.length));
  return [
    title,
    ...items.map((it, i) => `${i === s.cursor ? '❯' : ' '} ${s.checked[i] ? '◉' : '◯'} ${it.label.padEnd(width)}  \x1b[2m${it.hint}\x1b[0m`),
    '\x1b[2m↑/↓ move · Space toggle · a all · Enter install · Esc cancel\x1b[0m',
  ];
}

// Indexes of the checked items, or undefined when cancelled. Needs a TTY on stdin and stdout.
export function terminalPicker(title: string, items: PickerItem[]): Promise<number[] | undefined> {
  const { stdin, stdout } = process;
  let s: PickerState = { cursor: 0, checked: items.map(() => true) };
  let drawn = 0;
  const draw = () => {
    const lines = pickerLines(title, items, s);
    stdout.write((drawn ? `\x1b[${drawn}A\r\x1b[0J` : '') + lines.join('\n') + '\n');
    drawn = lines.length;
  };
  return new Promise((resolve) => {
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdout.write('\x1b[?25l');
    draw();
    const onKey = (_: string, key: Key) => {
      s = pickerStep(s, key ?? {});
      if (!s.done) return draw();
      stdin.off('keypress', onKey);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\x1b[?25h');
      resolve(s.done === 'ok' ? s.checked.flatMap((c, i) => (c ? [i] : [])) : undefined);
    };
    stdin.on('keypress', onKey);
  });
}
