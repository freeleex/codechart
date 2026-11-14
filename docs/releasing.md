# Releasing

For the maintainer. The workflow is `.github/workflows/publish.yml`; the notes come from `CHANGELOG.md`.

## Release

1. Open a PR that bumps `version` in `package.json` and renames `## Unreleased` in `CHANGELOG.md` to `## X.Y.Z (date)`. CI checks that the section exists.
2. Merge it.
3. Tag the merge commit and push the tag: `git tag -a vX.Y.Z -m vX.Y.Z && git push origin vX.Y.Z`.
4. Approve the `npm` environment when GitHub asks. The `publish` job then checks that the tag matches `package.json`, runs the tests, builds, checks the package contents and stages the package. Nothing is public yet.
5. On npmjs.com, approve the staged publish with 2FA.
6. The `github-release` job has already made a draft GitHub Release from the changelog section. It checks npm once a minute and makes the draft public once npm serves the version. It waits up to 350 minutes (just under 6 hours). If that runs out, publish the draft by hand, or re-run the failed jobs only. Never re-run the `publish` job: that stages the package a second time.

## A step failed

- **Before anything was staged** (the `publish` job failed): fix the cause and re-run the failed jobs. If the fix is a new commit, delete the tag, push it again on the new commit and approve again. Nothing is public.
- **Staged, not approved** (or you don't want it): reject the stage on npmjs.com, delete the draft release, and release the next patch version. Never reuse a version number.
- **`github-release` failed or timed out**: re-run the failed jobs only. A re-run reuses the draft that exists.

## A bad release

Roll forward.

1. Publish the next patch with the fix.
2. Deprecate the bad one: `npm deprecate codechart@X.Y.Z "broken: use X.Y.Z+1"`.

Moving `latest` back to the old version does not help people who already updated: `codechart update` never installs a lower version than the one you have, and the update notice can show a newer version it cached earlier for up to a day.

Unpublish only for leaked secrets. npm allows it for 72 hours after publishing, and the version number is gone for good.

## Mirror

`gitlab.com/freeleex/codechart` is a daily read-only mirror of the GitHub repo. Releases, issues and PRs live on GitHub.
