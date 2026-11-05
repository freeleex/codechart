import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { opencodeConfigFile, pinPlugin, pluginSpecs, refreshPlugin, removePlugin } from '../../src/commands/opencode-plugin.js';
import { makeSandbox, removeSandbox } from '../helpers/sandbox.js';

let tmp: string;
let home: string;

beforeEach(() => {
  ({ tmp, home } = makeSandbox('ocplugin'));
});

afterEach(() => removeSandbox(tmp));

const file = () => join(home, 'opencode.jsonc');
const put = (text: string) => writeFileSync(file(), text);
const read = () => readFileSync(file(), 'utf8');

describe('pinPlugin', () => {
  it('creates opencode.json with a schema when there is no file, or an empty one', () => {
    expect(pinPlugin(file(), '1.2.3')).toBe('added');
    expect(JSON.parse(read())).toEqual({ $schema: 'https://opencode.ai/config.json', plugins: ['codechart@1.2.3'] });
    put('  \n');
    expect(pinPlugin(file(), '1.2.3')).toBe('added');
    expect(JSON.parse(read()).plugins).toEqual(['codechart@1.2.3']);
  });

  it('appends to plugins and keeps comments, trailing commas and other settings byte for byte', () => {
    const text = '// my config\n{\n  /* theme */ "theme": "x",\n  "plugins": [\n    "other@1", // keep\n  ],\n  "model": "a/b", // last\n}\n';
    put(text);
    expect(pinPlugin(file(), '1.2.3')).toBe('added');
    expect(read()).toContain('// my config');
    expect(read()).toContain('/* theme */ "theme": "x",');
    expect(read()).toContain('"other@1", // keep');
    expect(read()).toContain('"model": "a/b", // last');
    expect(pluginSpecs(file())).toEqual(['codechart@1.2.3']);
    expect(read().replace(/\s*"codechart@1.2.3",?/, '')).toBe(text);
  });

  it('adds a plugins list when there is none, with the file indentation', () => {
    put('{\n\t"theme": "x"\n}\n');
    pinPlugin(file(), '1.2.3');
    expect(read()).toBe('{\n\t"theme": "x",\n\t"plugins": ["codechart@1.2.3"]\n}\n');
  });

  it('keeps CRLF line endings', () => {
    put('{\r\n  "a": 1\r\n}\r\n');
    pinPlugin(file(), '1.2.3');
    expect(read()).not.toMatch(/[^\r]\n/);
  });

  it('replaces a codechart entry of any version or form instead of adding a second', () => {
    for (const entry of ['"codechart"', '"codechart@0.1.0"', '"codechart@^1"']) {
      put(`{ "plugins": ["a", ${entry}, "b"] }`);
      expect(pinPlugin(file(), '1.2.3')).toBe('updated');
      expect(read()).toBe('{ "plugins": ["a", "codechart@1.2.3", "b"] }');
    }
  });

  it('keeps the options of the object form', () => {
    put('{ "plugins": [{ "package": "codechart@0.1.0", "options": { "x": 1 } }] }');
    expect(pinPlugin(file(), '1.2.3')).toBe('updated');
    expect(JSON.parse(read()).plugins).toEqual([{ package: 'codechart@1.2.3', options: { x: 1 } }]);
  });

  it('updates an entry in the legacy plugin key in place, adding no plugins list', () => {
    put('{ "plugin": ["codechart@0.1.0"] }');
    expect(pinPlugin(file(), '1.2.3')).toBe('updated');
    expect(JSON.parse(read())).toEqual({ plugin: ['codechart@1.2.3'] });
  });

  it('collapses entries in both keys, and repeats, to one', () => {
    put('{ "plugin": ["codechart@0.1.0", "x"], "plugins": ["codechart", "y", { "package": "codechart@0.2.0" }] }');
    expect(pinPlugin(file(), '1.2.3')).toBe('updated');
    expect(pluginSpecs(file())).toEqual(['codechart@1.2.3']);
    const s = JSON.parse(read());
    expect(s.plugins).toEqual(['codechart@1.2.3', 'y']);
    expect(s.plugin).toEqual(['x']);
  });

  it('pin then remove leaves the same settings in every layout', () => {
    const layouts = [
      '{}',
      '{ }',
      '{\n}\n',
      '{ "a": 1 }',
      '{\n  "a": 1\n}\n',
      '{\n  "a": 1,\n}\n',
      '{\n  "a": 1 // c\n}\n',
      '{\n  "a": 1, // c\n}\n',
      '{ "plugins": [] }',
      '{ "plugins": ["x"] }',
      '{ "plugins": ["x",] }',
      '{\n  "plugins": [\n    "x"\n  ]\n}\n',
      '{\n  "plugins": [\n    "x",\n  ]\n}\n',
      '{\n  "plugins": [\n    "x", // c\n    "y" /* d */\n  ]\n}\r\n',
      '{ "plugin": ["x"] }',
    ];
    // An empty list we created stays after remove: valid and harmless.
    const settings = (t: string) => {
      const s = JSON.parse(t.replace(/\/\*.*?\*\/|\/\/.*$/gm, '').replace(/,(\s*[\]}])/g, '$1')) as { plugins?: unknown[] };
      if (s.plugins?.length === 0) delete s.plugins;
      return s;
    };
    for (const text of layouts) {
      put(text);
      pinPlugin(file(), '1.2.3');
      expect(pluginSpecs(file()), text).toEqual(['codechart@1.2.3']);
      removePlugin(file());
      expect(pluginSpecs(file()), text).toEqual([]);
      expect(settings(read()), text).toEqual(settings(text));
    }
  });

  it('is a no-op when already pinned', () => {
    const text = '{\n  // c\n  "plugins": ["codechart@1.2.3"]\n}\n';
    put(text);
    expect(pinPlugin(file(), '1.2.3')).toBe('present');
    expect(read()).toBe(text);
  });

  it('does not mistake other packages for codechart', () => {
    put('{ "plugins": ["codechart-extra", "@x/codechart@1", "./codechart", { "package": "codecharts" }] }');
    expect(pluginSpecs(file())).toEqual([]);
    expect(pinPlugin(file(), '1.2.3')).toBe('added');
    expect(JSON.parse(read()).plugins).toHaveLength(5);
  });

  it('refuses a file it cannot parse or a wrong shape, leaving it alone', () => {
    for (const text of ['{ "plugins": [ ', '[1]', '{ "plugins": "x" }', '{ "plugin": {} }']) {
      put(text);
      expect(() => pinPlugin(file(), '1.2.3')).toThrow(file());
      expect(read()).toBe(text);
    }
  });

  it('writes through a symlink', () => {
    const real = join(tmp, 'dotfiles.json');
    writeFileSync(real, '{}');
    symlinkSync(real, file());
    pinPlugin(file(), '1.2.3');
    expect(JSON.parse(readFileSync(real, 'utf8')).plugins).toEqual(['codechart@1.2.3']);
  });
});

describe('refreshPlugin and removePlugin', () => {
  it('refresh rewrites an old pin and leaves a missing entry or file alone', () => {
    expect(refreshPlugin(file(), '1.2.3')).toBe('absent');
    put('{ "plugins": ["x"] }');
    expect(refreshPlugin(file(), '1.2.3')).toBe('absent');
    expect(read()).toBe('{ "plugins": ["x"] }');
    put('{ "plugins": ["codechart@0.1.0"] }');
    expect(refreshPlugin(file(), '1.2.3')).toBe('updated');
    expect(refreshPlugin(file(), '1.2.3')).toBe('present');
    put('{ nope');
    expect(refreshPlugin(file(), '1.2.3')).toBe('absent');
  });

  it('remove drops only codechart entries, keeping comments and commas valid', () => {
    put('{\n  "plugins": [\n    "a", // first\n    "codechart@0.1.0",\n    "b"\n  ],\n  "plugin": ["codechart"] // legacy\n}\n');
    expect(removePlugin(file())).toBe('removed');
    expect(read()).toContain('"a", // first');
    expect(read()).toContain('// legacy');
    expect(pluginSpecs(file())).toEqual([]);
    expect(JSON.parse(read().replace(/\/\/.*$/gm, '')).plugins).toEqual(['a', 'b']);
    expect(removePlugin(file())).toBe('absent');
  });

  it('remove of a missing file says absent', () => {
    expect(removePlugin(file())).toBe('absent');
  });
});

describe('opencodeConfigFile', () => {
  const dir = () => join(home, '.config', 'opencode');
  beforeEach(() => mkdirSync(dir(), { recursive: true }));

  it('prefers the file that names codechart, then any existing one, else a new opencode.json', () => {
    expect(opencodeConfigFile(home)).toBe(join(dir(), 'opencode.json'));
    writeFileSync(join(dir(), 'opencode.json'), '{}');
    expect(opencodeConfigFile(home)).toBe(join(dir(), 'opencode.json'));
    writeFileSync(join(dir(), 'opencode.jsonc'), '{}');
    expect(opencodeConfigFile(home)).toBe(join(dir(), 'opencode.jsonc'));
    writeFileSync(join(dir(), 'opencode.json'), '{ "plugins": ["codechart@0.1.0"] }');
    expect(opencodeConfigFile(home)).toBe(join(dir(), 'opencode.json'));
  });
});
