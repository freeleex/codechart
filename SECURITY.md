# Security policy

## Supported versions

Latest minor release only.

## Reporting a vulnerability

Use GitHub private vulnerability reporting: <https://github.com/freeleex/codechart/security/advisories/new>. Do not open a public issue.

Acknowledgement within 7 days, fix or mitigation within 30 days.

## Threat model

codechart runs on repos you do not trust, on specs written by an agent that may be prompt-injected, and its output is read in a browser, a terminal and chat.

Guarantees:
- No network calls at runtime, except `codechart pr-sync` (below).
- No shell. Child processes are read-only `git` commands (no fetch, no repo-config filters or hooks) and the OS opener, started with argument arrays.
- `codechart pr-sync` is the one command that writes outside your machine, and it runs only in a CI job you add from `templates/`. It reads and edits the description of the PR or MR that started the job through the GitHub or GitLab API (with the job's `GITHUB_TOKEN` or the `CODECHART_GITLAB_TOKEN` you store), and publishes the map SVG: on GitHub as one commit force-pushed to `refs/codechart/pr-<number>` (never a branch), on GitLab as a project upload. It replaces only the text between its `<!-- codechart:start -->` and `<!-- codechart:end -->` markers, renders the spec found there with the same checks as `render`, and skips saving when the PR moved on or the spec changed meanwhile. The GitHub template skips PRs from forks.
- Generated HTML loads nothing external and escapes all spec text in every context; pages carry a CSP.
- Terminal and Markdown output carry no control or escape bytes from specs or snippets.
- Flow anchors must resolve inside the repo root: `..`, absolute paths and anchors whose real path leaves the repo (including via symlinks) are rejected, as are `.git` directories, devices and files over 5 MB; one render reads at most 25 MB. A symlink that stays inside the repo is accepted.
- Output file names come from `[a-z0-9-]` slugs; prune deletes only generated files in the cache folder.
- Inputs are bounded (string lengths, regex size, YAML aliases and depth, node and step counts).
- Stored data: rendered HTML under the user cache dir. Summary pages hold diff hunks of the changed files, minus files that look like secrets (`.env`, keys, `.npmrc`, credentials files, private-key blocks). No telemetry.

Details: `docs/security-review.md`.

## Out of scope

- An agent running `git diff` or `git show` itself in an untrusted repo: that repo's `.git/config` can set `diff.external` or textconv drivers, which run commands. codechart's own git calls disable them; open untrusted repos (e.g. unpacked archives) with care.
- An attacker with write access to your agents' skills folders or `~/.config/codechart`.
- Vulnerabilities in a dev-only dependency that is not shipped in the npm tarball.

## Cache

Rendered HTML lives in the user cache dir (`~/.cache/codechart` by default, `web.outDir`), and so does the map SVG of `render --pr` (one `<slug>.svg` per map title, overwritten on each render). Summary pages include diff hunks of changed files (not of files that look like secrets). Per repo, the newest 20 files and anything younger than `web.maxAgeDays` are kept. Purge with `rm -rf ~/.cache/codechart`.

## Release integrity

The first release (v0.1.0) is published manually by the maintainer with 2FA (`npm publish --access public --provenance=false`; provenance needs a CI provider); later releases are staged from version tags by `.github/workflows/publish.yml` (stage-only trusted publisher, npm provenance) and go live only after the maintainer approves them on npmjs.com with 2FA. Verify with `npm audit signatures`.
