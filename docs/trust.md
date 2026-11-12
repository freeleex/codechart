# Why you can trust the diagram

codechart checks what the agent claims against your files and the git diff, and says so plainly when something doesn't match.

## The agent writes data, codechart draws

LLMs misalign hand-drawn ASCII, so the agent only describes nodes and links as JSON. Layout is code.

## Map claims are checked

- Each node's file must exist, and a quoted line must be in it.
- In a change summary, every new, changed or removed node must match git, not just appear in the diff (`--git`, `--since <base>`, `--commit <sha>`): `new` needs a file git adds, `removed` one it deletes, and `changed` one it modifies or renames.
- A listed field must appear in its file, and an arrow between two files should mention the other file's name, but the match is loose (case, `_` and `-` ignored) and a miss is only a warning.
- When everything matches, the footer says `✓ 10 checked`. Boxes without a file are counted separately: `✓ 10 checked · 3 not checkable`.

When it doesn't, the output opens with the mismatch. This one is from a render where the agent claimed an untouched table changed:

```text
✗ 1 claim doesn't match the code: ~customers not in diff
```

A git-status mismatch reads the same way:

```text
✗ 1 claim doesn't match the code: +orders marked new, but modified in git
```

Warnings sit below the ✗ lines, quieter than a failed check:

```text
⚠ 2 warnings: ~orders field loyalty_points not found · ~orders → +invoices no mention of invoices
```

The agent is told to fix its spec, or to keep the `✗` and own up when the change really differs from its summary. `--strict` turns mismatches into a non-zero exit, not warnings.

What is not checked: whether a label, summary or note is true, and boxes without a file, which are counted as not checkable. A matched line proves where to look, not that the box describes that code correctly.

## Plan vs built

The change summary is compared with the plan drawn before it: what was planned and not built, built and not planned, or built differently, each with the agent's reason, else `✗ … no reason given`. Details and an example: [Plan vs built](plans.md#plan-vs-built).

## Nothing left off quietly

With a diff, every changed file must sit under a node's path or be named in *Not on map* (lockfiles and generated files excepted), else:

```text
✗ 1 changed file not on map: src/x.ts
```

A summary rendered without a diff says `diff not checked` instead of looking verified.

A group deliberately left off the page (too many files to draw) is drawn as a dashed *omitted* box when its entry says what it is and why, like `frontend pages calling telemetry: frontend/src/pages/`. The box's panel lists the changed files that entry covers, from the same diff match the check uses. A bare `tests:` or `docs:` entry stays in the *Not on map* list, without a box.

## Flows are anchored to real code

Every step that exists in code names its `file:line` or quotes the line. If the line doesn't exist, the render fails and the agent has to fix it. For a commit that isn't checked out, `--at <rev>` reads the lines from that revision. See [Flows](flows.md).

## Explain maps

An [explain map](explain-map.md) describes code as it is, so only its boxes and the steps of its flows are checked:

- An `existing` box must name a file that exists, and its quoted line must be on exactly one line of it. An `outside` box is checked the same way when it names a file; an external service has none.
- Every step of a flow, and every branch out of a decision, must name a line that exists (as in a [flow](flows.md)). A mismatch is a `✗` on that step and in the header count, not a failed render. A step's `box` must be a box on the map, which the spec checks before drawing.
- There is no diff, so no *not on map* check, and no *diff not checked* note. Change statuses, edge or field change marks, `drift` and `omitted` are refused.

Limit: a box or step proves where to look, not that its summary is right or that the flow shows every path.

## Business maps

A [business map](business-map.md) is for readers who can't check the code, so more is checked before it is drawn:

- Every journey, rule and saved item links to boxes that exist on the technical map, which is the latest saved one on the branch or the spec you pass with `--tech`. An item with no link, or a link to nothing, fails the render.
- No sentence may look like code, a file name or path, a web address, a setting name, a technical id or a secret. A match fails the render with the offending word, and a secret is shown only as its first characters.
- Each item says how sure it is: **Checked in code**, or **Agent's reading, please confirm**, which the owner answers Yes or No.

A page that explains how an area works today is checked the same way, against an [explain map](explain-map.md): items link to its boxes or flow steps, and a change map is refused. The agent is told to mark *Checked in code* only for what it read, and to tell you in the reply what the code doesn't cover instead of guessing it onto the page. The page is read-only, has no questions and sends nothing back.

Limits: a link proves where to look, not that the words are right. The check cannot tell whether a sentence about the code is true, and plain words can still be wrong. Your agent is told to re-read the code behind each *Checked in code* item before drawing the page, but that is the agent's own spot-check, not something codechart verifies.

## Release maps

A [release map](release-map.md) is a PDF where a quick skim is enough: every line points to merged code. It holds only what the agent confirmed in the code, the PR text or the diff. codechart checks the page's shape and words, not the facts:

- Every text, in every section, passes the same plain-words check as a business map, and ids must be unique across the page.
- A spec with `questions` or `evidence` is refused: there is no owner to answer or confirm, and no *Agent's reading* tag to show.
- It has no tech links, so there is no tech map to check them against.

Limit: the check cannot tell whether a sentence is true. The skill tells the agent to ask you in the chat about anything it can't confirm, or leave it out, but that is the agent's rule, not something codechart verifies.

## Gaps are explicit

Whatever the agent didn't read is listed under `gaps`, not guessed.

## Validated input

Specs are checked against a schema, with clear errors the agent can act on.

## Related

- [Flows](flows.md)
- [Plans](plans.md)
- [Design](design.md): the spec contract and rendering
