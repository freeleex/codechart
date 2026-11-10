# The full page

Small diagrams stay in the agent's reply; big ones also get an interactive HTML page where you can explore each node, read its diff and mark what you've reviewed.

## When you get a page

- From 8 nodes on (`web.minNodes`), when the map is cut short in the terminal, or for rules marked `output: both`.
- *Open full map* in the reply opens it. See [Configuration](configuration.md#html-pages) to change when pages are written and where they go.

## The canvas

- Zoom and pan.
- Light, dark and auto themes, with a toggle in the header.
- Click a node to select it: it gets a blue glow, and everything except it and its neighbours dims. Esc or a click on the empty canvas clears it.
- Plans that touch existing code open as two panes, Now and After plan: see [Plans](plans.md).

## Status chips

A row under the header counts the nodes per status (`+4 new  ~5 changed  −1 removed  ◆2 config  ·3 context`). It doubles as the colour key.

- Click a chip to fade that status.
- *Δ changes only* fades the unchanged nodes, so only what changed stands out. An [explain map](explain-map.md) has only an *Outside* chip (nothing in it changed), and when it has flows, a tab row above it: **Components** and **Flows (n)**, with one sub-tab per flow. The chip belongs to Components; each view has its own pan and zoom, and *Reviewed* and *Next* count the view you are in. A *Side by side* switch at the right end of the tab row shows Components and a flow together, then counts both: see [Explain map](explain-map.md#side-by-side).
- Your choice is remembered.

## The node panel

Clicking a node opens its panel:

- Summary, file and fields; in a change summary, also its diff.
- ← → buttons go back and forward through the nodes you opened.
- ◎ zooms to the selected node.
- *Used by* and *Uses* list the node's links; click one to jump there.
- Gaps and *Not on map* items show in the info panel when no node is selected (header button *Not on map / gaps*).

## Diffs

In a change summary, each node's diff is read from git when the page is built, so the agent spends no tokens on it.

- The whole diff, up to 1000 lines per file, in a GitHub-style layout: full-row red and green tints, line numbers.
- Every hunk starts folded. Open one with a click, `n` / `p`, or *+ all*.
- Long unchanged runs collapse into a row you can click open.
- A pager bar (‹ 3 / 10 ›, *+ all*, *− all*) sits on top of the diff.
- Skipped: lockfiles, minified bundles, `dist/`, and files marked `linguist-generated` in `.gitattributes`. The panel says `generated file, not shown`.

## Reviewed ticks

- A tickbox left of the panel title (and on each node) marks the node reviewed.
- The header shows progress (*7/12 reviewed*) and *Next unreviewed*.
- A tick lasts until the node's diff changes.

## Keys

| Key | Does |
|---|---|
| `n` / `p` | Next / previous hunk (opens it, folds the rest) |
| `]` / `[` | Next / previous unreviewed node |
| `r` | Mark the node reviewed |
| `o` / `O` | Fold this hunk / all hunks |
| `f` | Zoom to the selected node |
| `c` | Add a note to the selected node |
| `?` | Key help |
| Esc | Clear the selection |

Keys do nothing while you type in a text field.

## Review notes

You can comment on nodes, lines, arrows and more, then send the notes to your agent: see [Review on the page](review.md#on-the-page).

## Privacy

- A page loads nothing from the internet and makes no network calls.
- It's saved to `~/.cache/codechart`, never to your repo. The newest 20 per repo are kept, plus anything under 7 days old.
- A summary page holds your diff: share it only where you'd share the diff.

## Related

- [Review](review.md)
- [Configuration](configuration.md#html-pages)
- [Security](../SECURITY.md)
