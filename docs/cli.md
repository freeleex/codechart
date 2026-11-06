# CLI commands

The skill calls these; you rarely need to. `codechart <command> --help` lists every option.

| Command | Purpose |
|---|---|
| `codechart check` | Which rules apply to changed files. `--files <csv>`, `--git`, `--commit <sha>`, `--since <base>` (+ `--head <ref>`), `--matched <csv>` |
| `codechart render <spec>` | Render a spec (JSON file or `-` for stdin). `--output auto\|cli\|web\|both`, `--theme auto\|light\|dark`, `--open`, `--md` (paste-ready markdown), `--at <rev>`; `--git`, `--commit <sha>`, `--since <base>` (+ `--head <ref>`) to check claims against the diff; `--strict` to exit 1 on a mismatch; `--pr` prints a map's PR/MR description section and writes its SVG to the cache folder (`--svg <file>` writes it elsewhere, `--image-url <url>` sets where the description loads it) |
| `codechart setup-pr-maps` | Add the CI job for [PR maps](pr-maps.md): shows the change and asks first. `--yes` (no question), `--pr` (open a pull/merge request instead of writing to the work tree), `--host github\|gitlab` |
| `codechart pr-sync` | In CI: redraw the map section of this PR or MR's description against its latest commit (see [PR maps](pr-maps.md)) |
| `codechart schema` | Spec JSON schema; `--flow` for flow specs, `--config` for the config file |
| `codechart config` | Config in effect and where each value comes from (`--json`) |
| `codechart init` | Write a commented starter `.codechart.yaml` at the git root (`--force` to overwrite) |
| `codechart install-skill` | Install the skill for the agents found in your home folder. `--agent <names>`, `--dir <path>`, `--force` to overwrite a folder that isn't an older codechart copy, `--no-reminder`, `--no-hook`, `--no-plugin` (or `--reminder`, `--hook`, `--plugin` for only one). See [Install and agents](install.md) |
| `codechart update` | Install the newest codechart with npm and refresh the skill copies, reminder lines and OpenCode plugin copy you have; `--check` only reports. See [Updating](install.md#updating) |
| `codechart uninstall` | Remove the skill, reminder lines, hooks and OpenCode plugin file; `--skill`, `--reminder`, `--hook`, `--plugin` to pick some |
| `codechart doctor` | Check that your agents can find codechart: per detected agent the skill (current, outdated, missing, or a folder that isn't codechart's), the reminder line, the Claude Code hook and the OpenCode plugin file, plus `codechart` on PATH and its version against the newest npm one seen (no network). Problems end with the command that fixes them: ✗ for a skill or CLI that is missing, outdated or not codechart's (exit 1), ⚠ for a missing reminder, hook or plugin, which you may have opted out of (exit 0); an outdated plugin copy, or a file of that name that isn't ours, is a ✗ (`--fix` refreshes only the outdated one). Agents sharing a skill folder show it once. `--fix` runs the ✗ fixes itself (never over a skill folder that isn't codechart's), only names the opt-in ones, and checks again. `--last` explains why the last turn in this repo did or didn't get a diagram (Claude Code, OpenCode). See [No diagram appeared](install.md#no-diagram-appeared) |
| `codechart hook prompt\|stop` | Run by the Claude Code hook (OpenCode's plugin runs inside OpenCode, not through this command); reads the hook's JSON on stdin and logs its decision for `doctor --last` |
| `codechart review` | Write review notes on the newest map of this branch in `$VISUAL`, `$EDITOR`, or `vi` (`notepad` on Windows): see [Console review](#console-review). `--change <title>` picks another map (its title or file name slug; any case), `--print` prints the document instead of opening an editor |
| `codechart comment <node>[:<path>:<line>] <text...>` | Add one pending note. `--kind comment\|question\|delete` (default comment), `--side old\|new`, `--change <title>` |
| `codechart feedback` | Print the pending notes as numbered markdown for an agent. `--take` marks them sent, `--copy` also copies them (OSC 52, on a terminal), `--change <title>` |

## Console review

Every map or flow `render` draws gets a `<same name>.review.json` in the cache folder, whatever the output mode (`cli`, `--md` or a page); a page, when there is one, sits beside it. It holds the map's title and file name slug (a flow's slug ends in `.flow`), its branch, each node's id, label, path and the diff lines the map showed, and your notes. The map a command works on is the newest one on the current branch, or the one named by `--change`. None on this branch: `No map to review on branch <branch> yet. Ask your agent for a map first.`

`review` opens a text file:

```
# Review: Orders and coupons · branch feat/coupons · drawn at 09:05
# Add a note on its own line under a node or a diff line:
#   > text    comment        >? text   question       >del text  delete this
# Lines starting with # are ignored. Save and quit when you are done; quit without saving to cancel.

## Order — app/orders.py  [Order]
@@ -1,2 +1,2 @@
   1  class Order:
-  2      pass
+  2      coupon = Column(Text)
>? is this nullable?

# Unchanged on the map (you can still note on them):
## Queue  [Queue]
```

The file is named after the map (`<title-slug>.diff`) so editors colour it as a diff; for `vi`, `vim`, `nvim`, `gvim` and `mvim`, codechart also turns syntax on (macOS's system vimrc leaves it off) and highlights `>` notes and `##` headings. `review --print` on a terminal colours the same way (red `-`, green `+`, cyan `@@`, dim `#`, bold headings, notes black on yellow); piped, or with `NO_COLOR` set, it is plain text.

A node heading is `## label — path  [id]`; the id in brackets is what the file is read by (and what an agent uses). Nodes with a diff come first, in map order; nodes without one are listed at the end. A node on the same file and diff as an earlier one says `# Same diff as "<label>" above.` instead of repeating it; notes under it are about the node. Diff rows are a sign, the line number and the code (new line numbers; old ones on `-` rows). Lines starting with `#` are ignored. A note is a line starting `>` (comment), `>?` (question) or `>del` (delete this); a note under a diff row points at that line (`+` and context rows: new side; `-` rows: old side), one under a node or hunk heading at the node. An empty note is dropped; a note above the first node, or under a heading you changed, can't be placed: `review` says which line, saves nothing, exits 1 and keeps the file, printing its path, so nothing you typed is lost. Line endings (LF, CRLF) don't matter. Saving replaces all pending notes with the ones in the file (the ones already there come back as `>` lines to edit or delete); notes already sent to your agent, and outdated ones, show as `#` comments and are untouched. Quitting without saving, or an editor exit status other than 0, saves nothing. If the code changed since the map was drawn (HEAD or the uncommitted files, for a map drawn with `--git` or `--since`), `review` warns first and shows the map's snapshot anyway.

`feedback` prints `# Review feedback: <title> (N notes)` and each pending note as `N. label (path:line, new line)  [id]` (`old line` for a removed one; node-level notes show the path only), the quoted line, then `Comment:`, `Question:` or `Delete:` and the text. `--take` then marks them sent, so the next run says `No pending review notes.`
