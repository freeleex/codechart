# Why you can trust the diagram

codechart checks what the agent claims against your files and the git diff, and says so plainly when something doesn't match.

## The agent writes data, codechart draws

LLMs misalign hand-drawn ASCII, so the agent only describes nodes and links as JSON. Layout is code.

## Map claims are checked

- Each node's file must exist, and a quoted line must be in it.
- In a change summary, every new, changed or removed node must be in the git diff (`--git`, `--since <base>`, `--commit <sha>`).
- When everything matches, the footer says `✓ 10 checked`.

When it doesn't, the output opens with the mismatch. This one is straight from a render where the agent claimed an untouched table changed:

```text
✗ 1 claim doesn't match the code: ~customers not in diff
```

The agent is told to fix its spec, or to keep the `✗` and own up when the change really differs from its summary. `--strict` turns mismatches into a non-zero exit.

## Plan vs built

The change summary is compared with the plan drawn before it: what was planned and not built, built and not planned, or built differently, each with the agent's reason, else `✗ … no reason given`. Details and an example: [Plan vs built](plans.md#plan-vs-built).

## Nothing left off quietly

With a diff, every changed file must sit under a node's path or be named in *Not on map* (lockfiles and generated files excepted), else:

```text
✗ 1 changed file not on map: src/x.ts
```

A summary rendered without a diff says `diff not checked` instead of looking verified.

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

A page that explains how an area works today is checked the same way, against an [explain map](explain-map.md): items link to its boxes or flow steps, and a change map is refused. The agent is told to mark *Checked in code* only for what it read, and to turn what the code doesn't cover into questions.

Limits: a link proves where to look, not that the words are right. The check cannot tell whether a sentence about the code is true, and plain words can still be wrong. Your agent is told to re-read the code behind each *Checked in code* item before drawing the page, but that is the agent's own spot-check, not something codechart verifies.

## Release maps

A [release map](release-map.md) is a PDF nobody reviews, so it holds only what the agent confirmed in the code, the PR text or the diff. codechart checks the page's shape and words, not the facts:

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
