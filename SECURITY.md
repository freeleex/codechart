# Security policy

## Supported versions

Latest minor release only.

## Reporting a vulnerability

Use GitHub private vulnerability reporting: <https://github.com/freeleex/codechart/security/advisories/new>. Do not open a public issue.

Acknowledgement within 7 days, fix or mitigation within 30 days.

## Threat model

codechart runs on repos you do not trust, on specs written by an agent that may be prompt-injected, and its output is read in a browser, a terminal and chat.

Guarantees:
- No network calls at runtime.
- No shell. Child processes are read-only `git` commands (no fetch, no repo-config filters or hooks) and the OS opener, started with argument arrays.
- Generated HTML loads nothing external and escapes all spec text in every context; pages carry a CSP.
- Terminal and Markdown output carry no control or escape bytes from specs or snippets.
- Flow anchors must resolve inside the repo root: `..`, absolute paths and anchors whose real path leaves the repo (including via symlinks) are rejected, as are `.git` directories, devices and files over 5 MB; one render reads at most 25 MB. A symlink that stays inside the repo is accepted.
- Output file names come from `[a-z0-9-]` slugs; prune deletes only generated files in the cache folder.
- Inputs are bounded (string lengths, regex size, YAML aliases and depth, node and step counts).
- Stored data: rendered HTML under the user cache dir. No telemetry.

Details: `docs/security-review.md`.

## Out of scope

- An agent running `git diff` or `git show` itself in an untrusted repo: that repo's `.git/config` can set `diff.external` or textconv drivers, which run commands. codechart's own git calls disable them; open untrusted repos (e.g. unpacked archives) with care.
- An attacker with write access to `~/.claude` or `~/.config/codechart`.
- Vulnerabilities in a dev-only dependency that is not shipped in the npm tarball.

## Cache

Rendered HTML lives in the user cache dir (`~/.cache/codechart` by default, `web.outDir`). Per repo, the newest 20 files and anything younger than `web.maxAgeDays` are kept. Purge with `rm -rf ~/.cache/codechart`.

## Release integrity

The first release (v0.1.0) is published manually by the maintainer with 2FA (`npm publish --access public --provenance=false`; provenance needs a CI provider); later releases are published from version tags by `.github/workflows/publish.yml` with npm provenance. Verify with `npm audit signatures`.
