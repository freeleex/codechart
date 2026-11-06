# Changelog

What's new in each codechart release. Update with `codechart update`; the [releases page](https://github.com/freeleex/codechart/releases) has the same notes.

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
