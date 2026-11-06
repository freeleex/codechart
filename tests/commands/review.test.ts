import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProgramOptions } from '../../src/program.js';
import { repoFolder } from '../../src/render/output-path.js';
import { defaultEditor } from '../../src/commands/review-editor.js';
import { gitBranch } from '../../src/rules/git-files.js';
import { readReview, saveReview, writeReview } from '../../src/review/store.js';
import { git, makeSandbox, removeSandbox, runCli } from '../helpers/sandbox.js';

let tmp: string;
let home: string;
let repo: string;
let out: string;
const t0 = new Date(2026, 9, 28, 9, 5, 3);
let clock = t0;

beforeEach(() => {
  ({ tmp, home, repo, out } = makeSandbox('review', { git: 'init', htmlOut: true }));
  mkdirSync(join(repo, 'app'));
  writeFileSync(join(repo, 'app/orders.py'), 'class Order:\n    pass\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  writeFileSync(join(repo, 'app/orders.py'), 'class Order:\n    coupon = Column(Text)\n');
  clock = t0;
});

afterEach(() => removeSandbox(tmp));

const spec = (title = 'Orders') => ({
  title,
  kind: 'summary',
  nodes: [
    { id: 'Order', label: 'Order', kind: 'model', status: 'changed', layer: 'backend', path: 'app/orders.py' },
    { id: 'Queue', label: 'Queue', kind: 'other', status: 'context', layer: 'backend' },
  ],
  edges: [],
});

const run = (args: string[], opts: Partial<ProgramOptions> = {}) => runCli({ cwd: repo, home, now: () => clock, isTTY: false, ...opts }, args);

async function render(title?: string) {
  const file = join(tmp, 'spec.json');
  writeFileSync(file, JSON.stringify(spec(title)));
  const r = await run(['render', file, '--git', '--output', 'web']);
  clock = new Date(clock.getTime() + 60_000);
  return r;
}

async function renderCli(title?: string, ...extra: string[]) {
  const file = join(tmp, 'spec.json');
  writeFileSync(file, JSON.stringify(spec(title)));
  const r = await run(['render', file, '--git', '--output', 'cli', ...extra]);
  clock = new Date(clock.getTime() + 60_000);
  return r;
}

const dir = () => join(out, repoFolder(repo));
const reviewFiles = () => readdirSync(dir()).filter((n) => n.endsWith('.review.json')).sort();
const current = (i = -1) => readReview(join(dir(), reviewFiles().at(i)!))!;

/** An editor that inserts `add` after the first doc line containing `after`. */
function typing(after: string, ...add: string[]): NonNullable<ProgramOptions['editor']> {
  return (_cmd, file) => {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.splice(lines.findIndex((l) => l.includes(after)) + 1, 0, ...add);
    writeFileSync(file, lines.join('\n'));
    return 0;
  };
}

describe('render writes the review file', () => {
  it('next to the page: change, branch, diff snapshot with rev, a stale fingerprint', async () => {
    await render();
    expect(readdirSync(dir())).toEqual(['20261028-090503-orders.html', '20261028-090503-orders.review.json']);
    const r = current();
    expect(r.change).toMatchObject({ slug: 'orders', kind: 'map', branch: gitBranch(repo), html: join(dir(), '20261028-090503-orders.html') });
    expect(r.change.range).toMatchObject({ worktree: true });
    expect(r.nodes[0]).toMatchObject({ id: 'Order', path: 'app/orders.py', rev: expect.stringMatching(/^[0-9a-f]{12}$/) });
    expect(r.nodes[0]!.lines).toEqual([
      { kind: 'hunk', text: '@@ -1,2 +1,2 @@' },
      { kind: 'ctx', n: 1, text: 'class Order:' },
      { kind: 'del', n: 2, text: '    pass' },
      { kind: 'add', n: 2, text: '    coupon = Column(Text)' },
    ]);
    expect(r.nodes[1]).toEqual({ id: 'Queue', label: 'Queue' });
  });

  it('a re-render of the same slug leaves one page and one review file', async () => {
    await render();
    await render();
    expect(reviewFiles()).toEqual(['20261028-090603-orders.review.json']);
  });
});

describe('codechart review', () => {
  it('--print: the document on stdout, nothing saved', async () => {
    await render();
    const r = await run(['review', '--print']);
    expect(r.out).toContain('# Review: Orders · branch ');
    expect(r.out).toContain('## Order — app/orders.py  [Order]\n@@ -1,2 +1,2 @@\n   1  class Order:\n-  2      pass\n+  2      coupon = Column(Text)\n');
    expect(r.out).toContain('# Unchanged on the map (you can still note on them):\n## Queue  [Queue]\n');
    expect(r.err).toBe('');
    expect(current().notes).toEqual([]);
  });

  it('--print on a terminal is coloured (unless NO_COLOR); piped it is plain', async () => {
    await render();
    const plain = (await run(['review', '--print'])).out;
    const tty = (await run(['review', '--print'], { isTTY: true })).out;
    expect(tty).toContain('\u001b[32m+  2      coupon = Column(Text)\u001b[0m');
    expect(tty).toContain('\u001b[1m## Order — app/orders.py  [Order]\u001b[0m');
    expect(tty.replace(/\u001b\[[0-9;]*m/g, '')).toBe(plain);
    expect(plain).not.toContain('\u001b');
    expect((await run(['review', '--print'], { isTTY: true, env: { NO_COLOR: '1' } })).out).toBe(plain);
  });

  it('opens $VISUAL, else $EDITOR, else vi, on a private temp file that is gone afterwards', async () => {
    await render();
    const seen: [string, string][] = [];
    const docs: string[] = [];
    const spy: NonNullable<ProgramOptions['editor']> = (cmd, file) => {
      seen.push([cmd, file]);
      docs.push(readFileSync(file, 'utf8'));
      return 0;
    };
    const runs = [await run(['review'], { editor: spy, env: { VISUAL: 'code --wait', EDITOR: 'nano' } })];
    expect(seen[0]![1]).toMatch(/[\\/]codechart-review-[^\\/]+[\\/]orders\.diff$/);
    runs.push(await run(['review'], { editor: spy, env: { EDITOR: 'nano' } }));
    runs.push(await run(['review'], { editor: spy, env: {} }));
    // An assertion thrown inside the editor callback would be swallowed as a failed command, so check afterwards.
    for (const x of runs) expect([x.err, x.code]).toEqual(['', undefined]);
    for (const d of docs) expect(d).toMatch(/^# Review: Orders · branch /);
    expect(seen.map(([c]) => c)).toEqual(['code --wait', 'nano', defaultEditor()]);
    expect(existsSync(seen[0]![1])).toBe(false);
  });

  it('saves the notes written in the editor, replacing the pending ones, and says what to tell the agent', async () => {
    await render();
    const r = await run(['review'], { editor: typing('+  2', '>? is this nullable?', '> rename it', '>del drop it') });
    expect([r.err, r.code]).toEqual(['', undefined]);
    expect(r.out).toBe('✔ 3 notes saved — 1 comment · 1 question · 1 delete\nTell your agent "review done" and it will pick up your notes.\n');
    const notes = current().notes;
    expect(notes.map((n) => [n.id, n.kind, n.body, n.state, n.anchor?.line, n.anchor?.side])).toEqual([
      ['n1', 'question', 'is this nullable?', 'pending', 2, 'new'],
      ['n2', 'comment', 'rename it', 'pending', 2, 'new'],
      ['n3', 'delete', 'drop it', 'pending', 2, 'new'],
    ]);
    expect(notes[0]).toMatchObject({ node: 'Order', rev: current().nodes[0]!.rev, anchor: { path: 'app/orders.py', text: '    coupon = Column(Text)' } });
    const again = await run(['review'], { editor: (_c, f) => (writeFileSync(f, readFileSync(f, 'utf8').replace('> rename it\n', '')), 0) });
    expect([again.err, again.code]).toEqual(['', undefined]);
    expect(again.out).toContain('2 notes saved');
    expect(current().notes.map((n) => n.id)).toEqual(['n1', 'n3']);
  });

  it('sent notes are untouched by a save', async () => {
    await render();
    await run(['comment', 'Queue', 'first']);
    await run(['feedback', '--take']);
    const saved = await run(['review'], { editor: typing('[Queue]', '> second') });
    expect([saved.err, saved.code]).toEqual(['', undefined]);
    expect(current().notes.map((n) => [n.body, n.state])).toEqual([['first', 'sent'], ['second', 'pending']]);
  });

  it('an unchanged file is "No changes"; a failing editor cancels with exit 1; neither saves', async () => {
    await render();
    const same = await run(['review'], { editor: () => 0 });
    expect(same.out).toBe('No changes, nothing saved.\n');
    const failed = await run(['review'], { editor: (_c, f) => (writeFileSync(f, '> x'), 3), env: { EDITOR: 'vim' } });
    expect(failed.err).toBe('codechart: The editor (vim) exited with status 3, so nothing was saved.\n');
    expect(failed.code).toBe(1);
    expect(current().notes).toEqual([]);
  });

  it('a note outside any node is dropped with a warning; the rest is saved', async () => {
    await render();
    const r = await run(['review'], { editor: (_c, f) => (writeFileSync(f, `> early\n${readFileSync(f, 'utf8')}`), 0) });
    expect(r.err).toBe("codechart: Line 1: this note isn't under a node, so it was skipped\n");
    expect(r.out).toContain('0 notes saved');
  });

  it('code changed since the render -> a warning before the document', async () => {
    await render();
    expect((await run(['review', '--print'])).err).toBe('');
    writeFileSync(join(repo, 'app/orders.py'), 'class Order:\n    coupon = None\n');
    expect((await run(['review', '--print'])).err).toBe('codechart: The code has changed since this map was drawn. Ask your agent to redraw it to review the latest.\n');
  });

  it('errors: nothing rendered on this branch, unknown --change', async () => {
    const none = await run(['review', '--print']);
    expect(none.err).toContain('No map to review on branch ');
    expect(none.err).toContain('Ask your agent for a map first.');
    expect(none.code).toBe(1);
    await render();
    expect((await run(['review', '--print', '--change', 'nope'])).err).toContain('No map called "nope"');
    git(repo, 'checkout', '-q', '-b', 'other');
    expect((await run(['review', '--print'])).err).toContain('on branch other yet');
  });

  it('--change picks a change by slug, not the newest', async () => {
    await render('Orders');
    await render('Billing');
    expect((await run(['review', '--print'])).out).toContain('# Review: Billing ·');
    expect((await run(['review', '--print', '--change', 'orders'])).out).toContain('# Review: Orders ·');
    expect((await run(['review', '--print', '--change', 'ORDERS'])).out).toContain('# Review: Orders ·');
  });

  it('a re-render keeps the notes where the diff is the same and marks them outdated where it moved', async () => {
    await render();
    await run(['comment', 'Order:app/orders.py:2', 'rename']);
    await run(['comment', 'Queue', 'why a queue']);
    await render();
    expect(current().notes.map((n) => n.state)).toEqual(['pending', 'pending']);
    writeFileSync(join(repo, 'app/orders.py'), 'class Order:\n    coupon = None\n');
    await render();
    expect(current().notes.map((n) => [n.node, n.state])).toEqual([['Order', 'outdated'], ['Queue', 'pending']]);
    expect((await run(['feedback'])).out).not.toContain('rename');
    expect((await run(['review', '--print'])).out).toContain('# Outdated, the code changed (comment): rename');
  });
});

describe('codechart comment', () => {
  it('node-level, line-level (new side, else old side) and --kind', async () => {
    await render();
    expect((await run(['comment', 'Queue', 'who', 'owns', 'this?', '--kind', 'question'])).out).toBe('✔ Question added to "Queue"\n');
    expect((await run(['comment', 'Order:app/orders.py:2', 'use', 'a', 'constant'])).out).toBe('✔ Comment added to "Order" (app/orders.py:2)\n');
    expect((await run(['comment', 'Order:1', 'ok?', '--side', 'new'])).out).toBe('✔ Comment added to "Order" (app/orders.py:1)\n');
    expect((await run(['comment', 'Order:app/orders.py:2', 'gone', '--side', 'old', '--kind', 'delete'])).out).toContain('✔ Delete added to');
    const notes = current().notes;
    expect(notes.map((n) => [n.id, n.node, n.kind, n.body, n.anchor?.side, n.anchor?.line, n.state])).toEqual([
      ['n1', 'Queue', 'question', 'who owns this?', undefined, undefined, 'pending'],
      ['n2', 'Order', 'comment', 'use a constant', 'new', 2, 'pending'],
      ['n3', 'Order', 'comment', 'ok?', 'new', 1, 'pending'],
      ['n4', 'Order', 'delete', 'gone', 'old', 2, 'pending'],
    ]);
    expect(notes[1]!.anchor!.text).toBe('    coupon = Column(Text)');
    expect(notes[3]!.anchor!.text).toBe('    pass');
    expect(notes[1]!.at).toBe(new Date(2026, 9, 28, 9, 6, 3).toISOString());
  });

  it.each([
    [['nope', 'x'], 'No node with the id "nope" on this map. Nodes: Order [Order], Queue [Queue].'],
    [['Order:app/orders.py:9', 'x'], 'Line 9 (new side) is not in the diff shown for "Order".'],
    [['Order:app/other.py:2', 'x'], '"Order" is app/orders.py, not app/other.py.'],
    [['Queue:3', 'x'], 'Line 3 (new side) is not in the diff shown for "Queue".'],
    [['Order:2', 'x', '--side', 'old', '--kind', 'bogus'], "option '--kind <kind>' argument 'bogus' is invalid"],
  ])('%j -> %s', async (args, message) => {
    await render();
    const r = await run(['comment', ...args]);
    expect(r.err).toContain(message);
    expect(current().notes).toEqual([]);
    expect(process.exitCode).toBeTruthy();
  });

  it('a blank note is refused', async () => {
    await render();
    expect((await run(['comment', 'Queue', '  '])).err).toBe('codechart: The note is empty.\n');
  });
});

describe('codechart feedback', () => {
  beforeEach(async () => {
    await render();
    await run(['comment', 'Order:app/orders.py:2', 'no', 'validation']);
    await run(['comment', 'Queue', 'why?', '--kind', 'question']);
  });

  it('prints the pending notes as numbered markdown and leaves them pending', async () => {
    const r = await run(['feedback']);
    expect(r.out).toBe(
      [
        '# Review feedback: Orders (2 notes)',
        '',
        '1. Order (app/orders.py:2, new line)  [Order]',
        '   >     coupon = Column(Text)',
        '   Comment: no validation',
        '',
        '2. Queue  [Queue]',
        '   Question: why?',
        '',
      ].join('\n'),
    );
    expect(current().notes.map((n) => n.state)).toEqual(['pending', 'pending']);
  });

  it('--take marks the printed notes sent; the next run has nothing', async () => {
    await run(['feedback', '--take']);
    expect(current().notes.map((n) => n.state)).toEqual(['sent', 'sent']);
    const r = await run(['feedback', '--take']);
    expect(r.out).toBe('No pending review notes.\n');
    expect(r.code).toBeUndefined();
  });

  it('--copy puts the text on the clipboard with OSC 52, on a terminal only', async () => {
    const text = (await run(['feedback'])).out;
    const tty = await run(['feedback', '--copy'], { isTTY: true });
    expect(tty.err).toBe(`\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`);
    expect(tty.out).toBe(text);
    expect((await run(['feedback', '--copy'], { isTTY: false })).err).toBe('');
  });

  it('--change reads another change', async () => {
    await render('Billing');
    expect((await run(['feedback'])).out).toBe('No pending review notes.\n');
    expect((await run(['feedback', '--change', 'orders'])).out).toContain('# Review feedback: Orders (2 notes)');
  });
});

describe('codechart review while the editor is open', () => {
  const addAfter = (file: string, after: string, line: string) => {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.splice(lines.findIndex((l) => l.includes(after)) + 1, 0, line);
    writeFileSync(file, lines.join('\n'));
  };

  /** What `render` does to the files, in-process: a new page and review file take over the notes, the older ones are pruned. */
  function rerender(mutateNodes: (r: NonNullable<ReturnType<typeof readReview>>) => NonNullable<ReturnType<typeof readReview>>['nodes'] = (r) => r.nodes): string {
    const old = join(dir(), reviewFiles().at(-1)!);
    const r = readReview(old)!;
    const html = join(dir(), '20261028-090900-orders.html');
    writeFileSync(html, '<html></html>');
    saveReview({ dir: dir(), file: html.replace('.html', '.review.json'), html, slug: 'orders', branch: r.change.branch, now: clock, snapshot: { kind: 'map', nodes: mutateNodes(r) } });
    rmSync(old);
    rmSync(old.replace('.review.json', '.html'));
    return html.replace('.html', '.review.json');
  }

  it('re-rendered meanwhile: the notes go to the new review file, not a resurrected old one', async () => {
    await render();
    await run(['comment', 'Queue', 'first']);
    const fresh = await run(['review'], {
      editor: (_c, f) => {
        rerender();
        addAfter(f, '[Queue]', '> second');
        return 0;
      },
    });
    expect([fresh.err, fresh.code]).toEqual(['', undefined]);
    expect(fresh.out).toContain('2 notes saved');
    expect(reviewFiles()).toEqual(['20261028-090900-orders.review.json']);
    expect(current().notes.map((n) => [n.body, n.state, n.node])).toEqual([['second', 'pending', 'Queue'], ['first', 'pending', 'Queue']]);
  });

  it('re-rendered meanwhile with the node gone or its diff changed: the note is outdated, not moved', async () => {
    await render();
    await run(['comment', 'Order:app/orders.py:2', 'rename']);
     const r = await run(['review'], {
      editor: (_c, f) => {
        rerender((r) => r.nodes.map((n) => (n.id === 'Order' ? { ...n, rev: 'changed' } : n)));
        addAfter(f, '[Queue]', '> q');
        return 0;
      },
    });
    expect([r.err, r.code]).toEqual(['', undefined]);
    expect(current().notes.map((n) => [n.body, n.state])).toEqual([['rename', 'outdated'], ['q', 'pending']]);
  });

  it('feedback --take meanwhile: a note sent while the editor was open stays sent', async () => {
    await render();
    await run(['comment', 'Queue', 'first']);
     const r = await run(['review'], {
      editor: (_c, f) => {
        const file = join(dir(), reviewFiles().at(-1)!);
        const r = readReview(file)!;
        writeReview(file, { ...r, notes: r.notes.map((n) => ({ ...n, state: 'sent' as const })) });
        addAfter(f, '[Queue]', '> second');
        return 0;
      },
    });
    expect([r.err, r.code]).toEqual(['', undefined]);
    expect(current().notes.map((n) => [n.body, n.state])).toEqual([['first', 'sent'], ['second', 'pending']]);
  });

  it('a note added with comment meanwhile is kept and ids do not collide', async () => {
    await render();
     const r = await run(['review'], {
      editor: (_c, f) => {
        const file = join(dir(), reviewFiles().at(-1)!);
        const r = readReview(file)!;
        writeReview(file, { ...r, notes: [{ id: 'n1', node: 'Queue', kind: 'comment', body: 'aside', state: 'pending', at: 'x' }] });
        addAfter(f, '[Queue]', '> written in editor');
        return 0;
      },
    });
    expect([r.err, r.code]).toEqual(['', undefined]);
    expect(current().notes.map((n) => [n.id, n.body])).toEqual([['n1', 'aside'], ['n2', 'written in editor']]);
  });

  it('a note deleted in the editor is gone even if it was re-rendered meanwhile', async () => {
    await render();
    await run(['comment', 'Queue', 'drop me']);
     const r = await run(['review'], {
      editor: (_c, f) => {
        rerender();
        writeFileSync(f, readFileSync(f, 'utf8').replace('> drop me\n', '') + '\n');
        return 0;
      },
    });
    expect([r.err, r.code]).toEqual(['', undefined]);
    expect(current().notes).toEqual([]);
  });

  it('branch switched meanwhile: the notes go to the branch the editor was opened on, not the one checked out now', async () => {
    const a = gitBranch(repo);
    await render();
    git(repo, 'checkout', '-q', '-b', 'other');
    await render();
    git(repo, 'checkout', '-q', a);
    const r = await run(['review'], {
      editor: (_c, f) => {
        git(repo, 'checkout', '-q', 'other');
        addAfter(f, '[Queue]', '> for A');
        return 0;
      },
    });
    expect([r.err, r.code]).toEqual(['', undefined]);
    const byBranch = (b: string) => reviewFiles().map((n) => readReview(join(dir(), n))!).find((x) => x.change.branch === b)!;
    expect(byBranch(a).notes.map((n) => n.body)).toEqual(['for A']);
    expect(byBranch('other').notes).toEqual([]);
  });

  // chmod does not stop root, nor Windows
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('saving fails: exit 1, the edited document is kept and its path printed', async () => {
    await render();
    let doc = '';
    const r = await run(['review'], {
      editor: (_c, f) => {
        doc = f;
        addAfter(f, '[Queue]', '> precious');
        chmodSync(dir(), 0o500);
        return 0;
      },
    });
    chmodSync(dir(), 0o700);
    expect(r.code).toBe(1);
    expect(r.err).toContain(`Your notes are kept in ${doc}`);
    expect(readFileSync(doc, 'utf8')).toContain('> precious');
    expect(current().notes).toEqual([]);
    rmSync(join(doc, '..'), { recursive: true });
  });

  it('change gone meanwhile: exit 1, the temp document is kept and its path printed', async () => {
    await render();
    let doc = '';
    const r = await run(['review'], {
      editor: (_c, f) => {
        doc = f;
        addAfter(f, '[Queue]', '> precious');
        const file = join(dir(), reviewFiles().at(-1)!);
        rmSync(file);
        rmSync(file.replace('.review.json', '.html'));
        return 0;
      },
    });
    expect(r.code).toBe(1);
    expect(r.err).toContain('No map called "orders"');
    expect(r.err).toContain(`Your notes are kept in ${doc}`);
    expect(readFileSync(doc, 'utf8')).toContain('> precious');
    rmSync(doc);
    rmSync(join(doc, '..'), { recursive: true });
  });
});

describe('terminal escapes from the repo never reach stdout', () => {
  it('review --print and feedback show the code with the escape bytes stripped', async () => {
    writeFileSync(join(repo, 'app/orders.py'), 'class Order:\n    x = "\x1b]52;c;ZXZpbA==\x07\x1b[2J\u200b"\n');
    await render();
    const doc = (await run(['review', '--print'])).out;
    expect(doc).toContain('x = "]52;c;ZXZpbA==[2J"');
    await run(['comment', 'Order:app/orders.py:2', 'bad\x1b[2Jbody']);
    const fb = (await run(['feedback'])).out;
    expect(fb).toContain('Comment: bad[2Jbody');
    for (const out of [doc, fb]) expect(out).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u200b]/);
    expect(JSON.stringify(current())).not.toContain('\\u001b');
  });
});

describe('pages of other branches', () => {
  const pageNames = () => readdirSync(dir()).filter((n) => n.endsWith('.html')).sort();

  it('a re-render replaces only the pages of its own branch; notes stay with their branch', async () => {
    const a = gitBranch(repo);
    await render();
    await run(['comment', 'Queue', 'note on A']);
    git(repo, 'checkout', '-q', '-b', 'other');
    await render();
    await run(['comment', 'Queue', 'note on B']);
    expect(pageNames()).toEqual(['20261028-090503-orders.html', '20261028-090603-orders.html']);
    expect((await run(['feedback', '--change', 'orders'])).out).toContain('note on B');

    git(repo, 'checkout', '-q', a);
    const bBefore = readReview(join(dir(), '20261028-090603-orders.review.json'))!;
    await render();
    expect(pageNames()).toEqual(['20261028-090603-orders.html', '20261028-090703-orders.html']);
    expect(existsSync(join(dir(), '20261028-090503-orders.review.json'))).toBe(false);
    expect(readReview(join(dir(), '20261028-090603-orders.review.json'))).toEqual(bBefore);
    expect(readReview(join(dir(), '20261028-090703-orders.review.json'))!.notes.map((n) => [n.body, n.state])).toEqual([['note on A', 'pending']]);
  });
});

describe('a render with no page still saves its review file', () => {
  const files = () => readdirSync(dir()).sort();

  it('--output cli: a review file where the page would be, no page and no html field; review, comment and feedback work', async () => {
    const r = await renderCli();
    expect(r.code).toBeUndefined();
    expect(files()).toEqual(['20261028-090503-orders.review.json']);
    if (process.platform !== 'win32') expect(statSync(join(dir(), files()[0]!)).mode & 0o777).toBe(0o600);
    expect(current().change).not.toHaveProperty('html');
    expect(current()).toMatchObject({ change: { slug: 'orders', title: 'Orders' }, nodes: [{ id: 'Order', lines: expect.any(Array) }, { id: 'Queue' }] });
    expect((await run(['review', '--print'])).out).toContain('## Order — app/orders.py  [Order]');
    expect((await run(['comment', 'Order:app/orders.py:2', 'rename'])).out).toContain('Comment added');
    expect((await run(['feedback', '--take'])).out).toContain('Comment: rename');
    expect(current().notes[0]!.state).toBe('sent');
  });

  it('--md and the other output modes too', async () => {
    await renderCli('Orders', '--md');
    expect(files()).toEqual(['20261028-090503-orders.review.json']);
  });

  it('a cli-only re-render replaces the older review file and carries the notes', async () => {
    await renderCli();
    await run(['comment', 'Order:app/orders.py:2', 'rename']);
    await renderCli();
    expect(files()).toEqual(['20261028-090603-orders.review.json']);
    expect(current().notes.map((n) => [n.body, n.state])).toEqual([['rename', 'pending']]);
    writeFileSync(join(repo, 'app/orders.py'), 'class Order:\n    coupon = None\n');
    await renderCli();
    expect(current().notes.map((n) => n.state)).toEqual(['outdated']);
  });

  it('another branch keeps its own review file', async () => {
    await renderCli();
    git(repo, 'checkout', '-q', '-b', 'other');
    await renderCli();
    expect(files()).toHaveLength(2);
  });

  it('web then cli: both files stay, the newest review file has the notes, the page is untouched; a later web render replaces both', async () => {
    await render();
    await run(['comment', 'Queue', 'first']);
    await renderCli();
    expect(files()).toEqual(['20261028-090503-orders.html', '20261028-090503-orders.review.json', '20261028-090603-orders.review.json']);
    expect(current().change).not.toHaveProperty('html');
    expect((await run(['feedback'])).out).toContain('Comment: first');
    await run(['comment', 'Queue', 'second']);
    await render();
    expect(files()).toEqual(['20261028-090703-orders.html', '20261028-090703-orders.review.json']);
    expect(current().notes.map((n) => n.body)).toEqual(['first', 'second']);
  });

  it('cli then web: the page replaces the review-only file', async () => {
    await renderCli();
    await run(['comment', 'Queue', 'first']);
    await render();
    expect(files()).toEqual(['20261028-090603-orders.html', '20261028-090603-orders.review.json']);
    expect(current().change.html).toBe(join(dir(), '20261028-090603-orders.html'));
    expect(current().notes).toHaveLength(1);
  });

  it('a flow drawn to the terminal gets one too', async () => {
    const file = join(tmp, 'flow.json');
    writeFileSync(file, JSON.stringify({ title: 'Order flow', kind: 'summary', start: 'a', steps: [{ id: 'a', label: 'add coupon', status: 'changed', source: 'app/orders.py:2' }], links: [] }));
    await run(['render', file, '--git', '--output', 'cli']);
    expect(files()).toEqual(['20261028-090503-order-flow.flow.review.json']);
    expect(current()).toMatchObject({ change: { kind: 'flow' }, nodes: [{ id: 'a', rev: expect.any(String) }] });
  });

  it('a review save that fails never fails the render', async () => {
    writeFileSync(out, 'not a folder');
    const r = await renderCli();
    expect(r.code).toBeUndefined();
    expect(r.out).toContain('Order');
    expect(r.err).toContain("Couldn't save review notes");
  });
});
