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

## Gaps are explicit

Whatever the agent didn't read is listed under `gaps`, not guessed.

## Validated input

Specs are checked against a schema, with clear errors the agent can act on.

## Related

- [Flows](flows.md)
- [Plans](plans.md)
- [Design](design.md): the spec contract and rendering
