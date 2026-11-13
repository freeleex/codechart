# Release map

A PDF of what is new in a release, in plain words, for sales and stakeholders. It shows what was already reviewed and is in main: a quick skim is enough, since every line points to merged code. No questions, no notes, no Yes/No. No code, file names or ids on it, and the reader needs no access to the repo.

<img src="images/release-map.gif" alt="The PDF of a release map: a cover with the logo, product name, version and summary, then the features one after another with their journeys, rules and what is kept" width="960">

## How to ask

```text
> make a release map of what's in the next release
```

The agent runs `codechart release-context` (the changes merged since the last `v*` tag; with no tag yet, every change from the first commit), groups them into features, writes a section for each, and runs `codechart render`. It replies with the PDF path and a link to the page. Your agent never makes one on its own, except on a release branch (below), and it never goes into a PR description. When you prepare a release with it (version bump, changelog, release notes, tag) and have no release branch set up, it offers one in a single line at the end of its reply, once per conversation. For a single change, use a [business map](business-map.md).

It only writes facts it checked in the code, the PR text or the diff. Anything it can't confirm it asks you about in the chat before rendering, or leaves out. The spec can't carry questions or an *Agent's reading* tag: a spec with either is refused.

## What is in it

- **Cover:** the logo, product name, version (and the one before), date, a short summary, and how many features are new, changed or fixed.
- **One section per feature** (up to 12): a *New*, *Changed* or *Fixed* badge, a short summary, then as many of these as apply:
  - **How it works:** journeys, steps today and steps after (up to 4);
  - **Rules:** before and after, with exceptions (up to 6);
  - **Information kept:** what the business now saves and why (up to 4).
  A small fix can be just a summary.

On each journey, *Before* shows today's steps in plain grey and *Now* marks the ones that are *New* or *Changed*; a rule shows *Before* and *Now*. Features flow one after another: a heading stays with its first content, a card is never split, a feature of up to three cards moves to the next page as a whole, and there is no forced page per feature. Page numbers sit bottom right, none on the cover. Light colours always, whatever your theme.

## The PDF

`codechart render` writes the page, then prints it to a PDF next to it with a Chromium-based browser in headless mode, and prints:

```text
Release map: What is new in Shop 2.0 (2.0.0) · 3 features · 1 new · 1 changed · 1 fixed
PDF: ~/.cache/codechart/shop-1a2b3c4d/20261109-100000-v2-0-0--what-is-new-in-shop-2-0.release.pdf
full map → file://…/20261109-100000-v2-0-0--what-is-new-in-shop-2-0.release.html
```

- **Browser:** the first of Google Chrome, Chromium, Microsoft Edge and Brave found where they are usually installed (`/Applications` on macOS, the `PATH` on Linux, Program Files and `LOCALAPPDATA` on Windows). To use another, set `release.browser` to its absolute path in your global config. A repo config can't set it: it names a program to run.
- **`--pdf <file>`:** write the PDF there instead of next to the page. Absolute or relative to where you run it, ending in `.pdf`, in a folder that exists.
- **No browser, or it fails:** the page is kept, one line says no PDF was made, and the command still succeeds. Open the page in any browser and use *Save as PDF*: it looks the same on screen as on paper.
- **Clean-up:** pages are pruned like the others (the newest render of a release replaces older ones); a PDF next to a pruned page stays, so copy it where you keep it or use `--pdf`.

## Product name and logo

In the repo's `.codechart.yaml`:

```yaml
release:
  product: Acme Shop
  logo: docs/logo.svg
```

Without `product` the cover uses the repo name. The logo is a repo-relative `.svg` or `.png` of at most 200 KB; it is embedded in the page, which still loads nothing from the internet. A logo that is missing, too big, the wrong type, or outside the repo (an absolute path, `..`, or a symlink that leaves the repo) is skipped with a warning on stderr; the page and PDF are still made. See [Configuration](configuration.md).

## On release branches

`codechart check` tells the agent when you are on a release branch. With `release.branches` (default `v[0-9]*`, `release-*`, `release/*`) and `release.auto`, its output gets a `release` object: `{ "action": "suggest", "branch": "release-0.8.0", "version": "0.8.0" }`. The version is the first `x.y.z` or `x.y` in the branch name, after an optional `v`, if there is one.

| `release.auto` | The agent |
|---|---|
| `suggest` (default) | ends its reply with a one-line offer of a release map, once per conversation |
| `draw` | makes the release map, once: when a PDF or page for that version is already saved, `check` says `"action": "done"` with its `path`, and the agent just mentions it |
| `off` | says nothing; no `release` key |

A saved page matches when its version is the same, ignoring trailing `.0`: `release-2.1.0` finds a `2.1` page, `release/1.2` finds `1.2.0` but not `1.2.1`. A branch with no version in its name can't be matched to a saved PDF, so there `check` only says `suggest`, even with `draw`. A detached HEAD, or any other branch, has no `release` key. `--head <branch>` checks that branch instead.

## What is checked

Before the page is drawn:

- the version looks like a version, the date is a real `YYYY-MM-DD` date, a section's `change` is `new`, `changed` or `fixed`, and ids are unique across the whole page;
- every sentence passes the same plain-words check as a business map: no code, file name or path, web address, setting name, secret or technical id;
- no `questions` and no `evidence` on any item.

A wrong sentence can pass every check: a quick skim is enough, since every line points to merged code, so the agent is told to write only what it confirmed. See [Why you can trust the diagram](trust.md#release-maps).

## Limits

- HTML page and PDF only: no terminal or PR version, and no notes sent back. `--pr` and `--tech` are refused.
- The PDF comes from the browser's own layout, so page breaks follow the browser.
- Sharing the HTML file: see [Business map](business-map.md#limits).

## Related

- [Business map](business-map.md)
- [CLI commands](cli.md)
- [Configuration](configuration.md)
