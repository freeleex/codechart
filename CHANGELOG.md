# Changelog

What's new in each codechart release. Update with `codechart update`; the [releases page](https://github.com/freeleex/codechart/releases) has the same notes.

## Unreleased

### New

- Every map box and explain node carries a short summary paragraph now: what it does, its role in the system. The page shows it at the top of the node's panel and inside the box. The agent is told to write one on every node.
- Omitted groups on the page: a *Not on map* entry that says what the group is and why it is off the map (`frontend pages calling telemetry: frontend/src/pages/`) is drawn as a dashed *omitted* box in that area. Its panel lists the changed files the entry covers; a bare `tests:` or `docs:` list stays in the page info without a box.
- Business page that explains how something works today: ask your agent to explain an area for a product owner, QA or support. One lane diagram of who does what, with every yes and no branch, then rules, odd cases and saved data in plain words. It starts from the explain map of that area (the newest one on your current branch) and is read-only: no notes or replies.

### Fixed

- Plan vs built no longer calls a file "built in another file" when only its path is spelled differently (`src\db.ts`, `./src/db.ts`, or relative to the folder you ran from), on maps and on flow steps.
- A flow anchor written Windows-style (`src\b.py:2`) for a file at its exact repo path now gets the "did you mean" hint.
- `codechart render --tech` no longer accepts an explain map for a business change page; it says a change map is needed.
- A path rule's `context: short` now wins over `defaults.context: full` when it is the only rule that fired.
- The business-map docs no longer say explain pages turn gaps into questions.
- The HTML check line keeps each claim's own colour: `✓ 15 nodes checked against the code` stays green next to a red `✗ 1 changed file not on map`; warnings are amber and `diff not checked` muted. One failed claim used to paint the whole line red.
- On Windows, the `gh`, `glab`, `powershell` and `opencode` commands that codechart runs are now looked up on PATH before they run, so a file inside your repo can't stand in for one of them.
- A note of several lines keeps all of them after `codechart review`: saving the editor used to keep only the first line, and a later line that looked like a diff row could move the note to another line.
- Page notes on a gap, arrow or box whose text has a colon in it come back with their own words: the copied message now shows that colon as a dash, so the item's text can no longer end up inside the note.
- A line in a page note that starts with `>` keeps its `>` when you import the notes. A review pasted as a quote still imports.
- A note on a long gap in a flow imports: it used to make the whole pasted review count as damaged.
- `codechart setup-pr-maps --pr` run a second time, before the setup pull request is merged, links that request instead of failing on the push.
- A failed git push or fetch in the PR map commands says why (`! [rejected] … (non-fast-forward)`, with the server's reason when a hook declines it), not just `To <remote>`.
- `codechart setup-pr-maps` on GitLab: when your `.gitlab-ci.yml` lists `stages:` without `test`, the appended job runs in your first stage, so the file stays valid.
- `codechart release-context` keeps the PR text it could read when one `(#N)` number isn't a PR (often an issue), and lists the skipped numbers in `notes`. After a timeout or network failure it stops asking and says which PRs were not read. On Windows, `gh` or `glab` missing from PATH is reported as not installed.
- `codechart release-context` with no tag before the release commit (none yet, or `v1.0.0` already on it) lists every commit from the first one, for a first release; it used to ask for `--since`, which could never include the first commit. When the tags before it don't start with `v`, it still asks for `--since` and says so; in a shallow clone it asks you to fetch the full history and tags.
- The release map docs show the real PDF and page file names.
- `--git` now sees renames even when your git config turns rename detection off.
- When a flow step points at a file that doesn't exist, the "did you mean" hint also offers files not yet added to git.
- Flow steps and map boxes that point at a secret-looking file (like `.env`) show "not shown: looks like a secret" instead of the line.
- `--md` output for business and release maps keeps the page title inside the code block, so image Markdown or HTML in a title no longer shows up in chat.
- The map section in a PR or MR description handles file names with blank lines or escape characters safely.
- `setup-pr-maps --pr` no longer goes online or runs your git transport config until you answer yes.
- `doctor --last` and `setup-pr-maps` strip escape characters from repo text they print, and a remote URL containing them is refused.
- `setup-pr-maps` refuses to write through a symlinked `.github` or `.github/workflows` folder.
- `uninstall` also removes skill copies installed with `install-skill --dir`.
- `feedback --import` reads the clipboard when stdin is empty or `/dev/null`, instead of failing with "No codechart review found".
- Two hook runs at the same moment no longer lose a turn's snapshot, and the hook no longer hangs when the transcript path is a pipe.
- Conflicting flags are refused with exit 2: `doctor --fix --last`, `update --check --skills-only`, `comment --side` without a line, and `feedback --import --copy` without `--take`.

### Changed

- `codechart install-skill` run outside a terminal now installs only the skill and prints the flags that would add the reminder line, Claude Code hook and OpenCode plugin; before, it added them all without asking. It may edit global files (`~/.claude/CLAUDE.md`, your agents' `AGENTS.md`/`GEMINI.md`, `~/.claude/settings.json`), which the README now says up front.
- The PR-maps workflow template for GitHub pins `actions/checkout` and `actions/setup-node` to exact commits, like this repo's own CI.
- The map check now compares each new, changed and removed box with git's own added, modified, deleted or renamed status, not just the list of changed files. It also warns, without failing, when a listed field or arrow isn't backed by the code, and says how many boxes it could not check.
- `render` and `install-skill` now exit 2 for a bad flag value (an unknown commit or agent) and 1 for other failures.

## 0.9.0 (2026-11-10)

### New

- Release map: ask your agent for a PDF of what's new in a release, a plain-words section per feature for sales and stakeholders, with only facts checked in the code.
- The PDF is printed with the Chrome, Chromium, Edge or Brave you already have; without one you get the page to Save as PDF yourself.
- On a release branch (`v1.2.0`, `release-1.2.0`, `release/1.2`) the agent offers a release map. Set `release.auto: draw` to have it made once per version.
- Your product name and logo on the cover: `release.product` and `release.logo` in the config.
- `codechart release-context` lists what was merged since the last `v*` tag, with each PR's text and map, for the agent writing the release map.

## 0.8.0 (2026-11-08)

### New

- Business map: ask your agent for a plain-words page of a change for a product owner with no repo access: journeys today and after, rules before and after, saved data, questions.
- The owner answers, says Yes or No to the agent's guesses, adds notes and presses *Send back to developer*, even days later; paste the text to your agent.
- Review on the page: comment on any node, diff line or arrow, ask a question or ask for a deletion. *Finish review* copies your notes; paste them into your agent chat.
- Review in the terminal: `codechart review` opens the map in your editor as a diff. Write notes under any line, save, and tell your agent "review done".
- Plan vs built: when the work is done, the summary is compared with the saved plan. What was dropped, added or built differently is marked, each with the agent's reason.
- `codechart render --tech <spec.json>` names the technical map a business map links to; `codechart schema --business` prints the business map format.

### Fixed

- Plan vs built no longer compares an old plan with later, unrelated summaries on the same branch.

### Changed

- README is shorter, with a features table; details moved to pages under [docs](https://github.com/freeleex/codechart/tree/main/docs).

## 0.7.0 (2026-11-06)

### New

- HTML: Focus button (◎, or `f`) zooms in on the node you are reviewing and centres it; that node now has a soft blue glow so you can tell it from its lit neighbours.
- HTML diffs: long runs of unchanged lines fold into "⋯ N unchanged lines" (click to open), and "⋯ N lines not in the diff" marks code between hunks.

### Changed

- HTML diffs look like GitHub's: full-row red/green tints, line numbers, a quiet header per hunk. Every hunk starts collapsed.
- HTML: the Light/Full switch from 0.6.0 is gone; every page shows the full diff.
- HTML panel: the review tickbox sits left of the node title, the file path shows once, and relations are two columns (← Used by, Uses →).
- HTML header: the build time reads like `6 Nov 2026, 19:44`.

## 0.6.0 (2026-11-06)

### New

- HTML: Light/Full switch in the header, remembered per browser. Light keeps the short diff preview; Full shows every change of a node so you can review without going back to your IDE.
- HTML Full: hunks are foldable per file, with a `‹ 4 / 7 ›` stepper, `+ all` / `− all`; keys `n`/`p` hunk, `]`/`[` unreviewed node, `r` reviewed, `o`/`O` fold, `?` help.
- HTML: review ticks, the `Reviewed` box and the `x/y reviewed` bar now live in Full mode.

### Changed

- Lockfiles, minified bundles, `dist/` and files marked `linguist-generated` show "generated file, not shown" instead of their diff. Full mode shows up to 1000 lines per file.
- HTML diffs: the `+`/`−` sign has its own column and long lines wrap under the code, keeping their indent.

## 0.5.0 (2026-11-05)

### New

- `codechart doctor` checks your setup for each agent (skill, reminder line, Stop hook, OpenCode plugin, CLI version); `--fix` repairs what's broken, `--last` explains why the last turn got no diagram.
- OpenCode plugin: OpenCode 2 now gets the same "3+ files changed and no map" nudge as Claude Code. `install-skill` adds it, `--no-plugin` skips it.
- HTML: selecting a node lights up its neighbours and dims the rest; the side panel lists its relations, each one a link.
- HTML: status chips under the header are the legend and a filter; click one to fade that status, `Δ changes only` fades unchanged nodes.
- HTML: tick nodes as reviewed, with an `x/y reviewed` count and `Next ▸`; ticks are kept per browser and reset when a node's diff changes.

## 0.4.0 (2026-11-05)

### New

- Maps in pull and merge requests: the map and its check overview in the description, re-rendered by CI on every push (GitHub and GitLab); set up with `setup-pr-maps`, see [PR maps](https://github.com/freeleex/codechart/blob/main/docs/pr-maps.md).
- `codechart update` installs the newest version and refreshes your skill copies and reminder lines; a once-a-day notice says when there is one (off with `updateCheck: false`).
- Summary maps flag changed files that no node covers, and say when the diff wasn't checked.
- HTML: browser Back/Forward and ← → buttons walk the nodes you opened; `#node=<id>` links open a node.
- Terminal map: status marker in a gutter (`+ invoices`), one block per node, and `--md` uses a `diff` fence so agents' chats colour new and removed lines.
- `install-skill` adds the reminder line and Claude Code hook by default (`--no-reminder`, `--no-hook` to skip) and updates older codechart skill copies in place.

### Fixed

- File and class nodes no longer look the same: map cards show the kind and a shape per kind.
- Labels that read as code (`_l([...])`) fail validation with a request to use plain words.
- Each check mismatch now says in plain words what it means.

## 0.3.1 (2026-11-03)

### Changed

- Security review fixes; see [security review](https://github.com/freeleex/codechart/blob/main/docs/security-review.md).
- Faster previews on big diffs (100 files: 1.8 s → 0.1 s) and shorter agent output (one error per missing file).

## 0.3.0 (2026-11-03)

### New

- Infrastructure maps: Terraform, OpenTofu, Terragrunt, Helm, Kustomize and Kubernetes changes get a map through the built-in `infrastructure` path rule.
- Now/After pages show two panes only when they differ, with a `Panes: linked/separate` toggle.
- Listed on skills.sh; the skill says to run `npm i -g codechart` when the CLI is missing.

## 0.2.0 (2026-11-03)

### New

- Map nodes are checked against the code (file exists, quoted line matches, in the diff for summaries); output leads with the check result.
- Plans that change existing code render Now and After side by side, for maps and flows.
- Node panel shows the file's diff; the panel is wider, resizable and wraps code.
- Each map picks top-down or left-to-right layout, whichever fits.
- Opt-in reminder line and Claude Code Stop hook (`install-skill --hook`).
