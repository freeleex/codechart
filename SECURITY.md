# Security policy

## Supported versions

Latest minor release only.

## Reporting a vulnerability

Use GitHub private vulnerability reporting: <https://github.com/freeleex/codechart/security/advisories/new>. Do not open a public issue.

Acknowledgement within 7 days, fix or mitigation within 30 days.

## Threat model

codechart runs on repos you do not trust, on specs written by an agent that may be prompt-injected, and its output is read in a browser, a terminal and chat.

Guarantees:
- No network calls at runtime, except `codechart pr-sync` (below) and the update check: at most once a day, after a command, one GET of `https://registry.npmjs.org/codechart/latest` (1 s timeout, no data sent, never in CI or under npx), off with `updateCheck: false` (global config only, so a repo can't turn it back on) or `CODECHART_NO_UPDATE_CHECK`/`NO_UPDATE_NOTIFIER`. The answer must be an `x.y.z` version and is stored in the cache dir. When that version is newer, the same check (and `codechart update`) also does one GET of `https://raw.githubusercontent.com/freeleex/codechart/v<that version>/CHANGELOG.md` (URL built from the validated version, 1 s timeout, no data sent, body over 256 KB dropped); at most 5 bullets are kept, stripped of control characters and link targets and cut to 200 characters, then stored in the cache dir and printed or put in an escaped HTML tooltip. `codechart update` runs `npm install -g codechart@<that version>` only when npm installed codechart.
- No shell. Child processes are read-only `git` commands (no fetch, no repo-config filters or hooks) and the OS opener, started with argument arrays.
- `codechart setup-pr-maps` adds that CI job only after the user says yes (or passes `--yes`): it prints the whole file first, writes it to the work tree without committing, refuses symlinks and other non-regular files, and never overwrites a file that isn't codechart's. With `--pr` it pushes one new branch, `codechart/pr-maps`, built in a scratch index on top of the remote's default branch (the work tree, index and current branch are not touched), and opens a pull/merge request with the user's own `gh`/`glab`. It never reads or stores tokens. The job it writes pins the installed codechart version.
- `codechart pr-sync` is the one command that writes outside your machine, and it runs only in a CI job you add with `codechart setup-pr-maps` or from `templates/`. It reads and edits the description of the PR or MR that started the job through the GitHub or GitLab API (with the job's `GITHUB_TOKEN` or the `CODECHART_GITLAB_TOKEN` you store), and publishes the map SVG: on GitHub as one commit force-pushed to `refs/codechart/pr-<number>` (never a branch), on GitLab as a project upload. It replaces only the text between its `<!-- codechart:start -->` and `<!-- codechart:end -->` markers, renders the spec found there with the same checks as `render`, and skips saving when the PR moved on or the spec changed meanwhile. The GitHub template skips PRs from forks.
- Generated HTML loads nothing external and escapes all spec text in every context; pages carry a CSP.
- Terminal and Markdown output carry no control or escape bytes from specs or snippets.
- Flow anchors must resolve inside the repo root: `..`, absolute paths and anchors whose real path leaves the repo (including via symlinks) are rejected, as are `.git` directories, devices and files over 5 MB; one render reads at most 25 MB. A symlink that stays inside the repo is accepted.
- Output file names come from `[a-z0-9-]` slugs; prune deletes only generated files in the cache folder.
- Inputs are bounded (string lengths, regex size, YAML aliases and depth, node and step counts).
- Stored data: rendered HTML under the user cache dir. Summary pages hold diff hunks of the changed files (up to 1000 rows per file), minus files that look like secrets (`.env`, keys, `.npmrc`, credentials files, private-key blocks) and generated files (lockfiles, minified bundles, `dist/`, `linguist-generated`). Each render also writes a `.review.json` beside it (0600, same folder and pruning) with the same diff lines and your review notes; it is written to a temp file and renamed into place, under a short-lived `.lock` file when `comment`, `feedback --take` or `review` update it. No telemetry.
- `codechart review` writes its document to a private temp folder (0700, removed afterwards) and opens it with `$VISUAL`/`$EDITOR`/`vi` (`notepad` on Windows) through `sh -c`, as git does: the editor setting is yours and runs as a command; the file path is passed as an argument, never spliced in. Windows has no `sh`, so there cmd.exe runs one line with the temp path in double quotes: the path is ours (temp folder plus a `[a-z0-9-]` name) and a Windows path cannot contain `"`. Diff text and notes are stripped of control bytes before they are written, printed or copied; `feedback --copy` emits one OSC 52 sequence to stderr, only on a terminal.

Details: `docs/security-review.md`.

## Out of scope

- An agent running `git diff` or `git show` itself in an untrusted repo: that repo's `.git/config` can set `diff.external` or textconv drivers, which run commands. codechart's own git calls disable them; open untrusted repos (e.g. unpacked archives) with care.
- An attacker with write access to your agents' skills folders or `~/.config/codechart`.
- Vulnerabilities in a dev-only dependency that is not shipped in the npm tarball.

## Cache

Rendered HTML lives in the user cache dir (`~/.cache/codechart` by default, `web.outDir`), and so does the map SVG of `render --pr` (one `<slug>.svg` per map title, overwritten on each render). Summary pages include diff hunks of changed files (not of files that look like secrets or are generated), and so do the `.review.json` files beside them, with your review notes. Per repo, the newest 20 files and anything younger than `web.maxAgeDays` are kept. Purge with `rm -rf ~/.cache/codechart`.

## Release integrity

The first release (v0.1.0) is published manually by the maintainer with 2FA (`npm publish --access public --provenance=false`; provenance needs a CI provider); later releases are staged from version tags by `.github/workflows/publish.yml` (stage-only trusted publisher, npm provenance) and go live only after the maintainer approves them on npmjs.com with 2FA. Each release's notes come from `CHANGELOG.md`: the release PR adds its section (CI checks it), and after staging the tag's workflow creates the GitHub Release from it as a draft, made public once npm serves that version (it waits up to 6 hours; later, publish the draft by hand) with the job's own `contents: write` token (the only job with write access). Verify with `npm audit signatures`.
