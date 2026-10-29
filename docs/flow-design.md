# codechart: Flow maps — Design

Status: approved by the user 2026-10-28 · 2026-10-28 · extends [design.md](design.md)

## 1. Why

codechart's relationship maps answer "what is connected to what?" (files, tables, models, config). They don't answer "what happens, in what order, and where does it branch?" That is where edge cases live, and it's the part of a large behavioural change that is hardest to follow from a summary or a diff.

The trigger for this feature was a flowchart Greptile drew for codechart's own `render` command: read the spec → validate → load config → *output mode?* → `none` / `cli` / `auto` → *hidden nodes or ≥ 8 nodes?* → … The user's reaction: that diagram is exactly what they want to be able to get from codechart, so they can see at a glance how the code behaves.

## 2. What it is

A second diagram type, the **flow map**:
- **Contents:** steps, decisions and labelled branches for **one behaviour**, such as a command, an endpoint, a job or a handler.
- **Who builds it:** the agent writes a flow spec, and the codechart CLI validates and draws it. This is the same split as for relationship maps.
- **Plans:** the agent draws the behaviour it *intends* to build, so the user can catch a missing branch before the code exists.
- **Change summaries:** the agent draws the behaviour that was built, from code it read or wrote.
- **Several behaviours:** the agent produces several small flows, one spec and one `render` call each, never one huge flow.
- **Both kinds together:** a single change can produce a relationship map **and** one or more flows.

## 3. Goals

- See at a glance how a behaviour works, including its edge cases.
- Every drawn branch is real: it is either anchored to code, or explicitly marked as planned.
- Same output model as maps: terminal when it fits, preview plus link when it doesn't, link only when nothing is worth previewing. The `auto` HTML rule applies.
- Three ways to get one: on request, automatically when the agent judges it worthwhile (default), or always.

## 4. Non-goals

- No static analysis or control-flow extraction. The agent builds the flow from what it read.
- No sequence diagrams, state machines or call graphs in this feature.
- No cross-function call tracing beyond what the agent chooses to include as steps.

## 5. Anti-goals

- **An invented branch is the worst failure.** A flow showing a branch that doesn't exist in the code, or presenting intended behaviour as existing behaviour, destroys the user's trust in the tool. Every rule in §6 serves this.
- An unnecessary small tree is a minor annoyance, not a failure. When in doubt between "too often" and "invented", prefer the false positive.

## 6. Trust rules

- **Statuses:** every step has one of `existing`, `new`, `changed` or `planned`.
  - In a **summary** spec (`kind: "summary"`), `planned` is not allowed.
  - In a **plan** spec (`kind: "plan"`), only `existing` and `planned` are allowed (`new` and `changed` are rejected).
    - `planned` marks anything the plan adds or alters, including a planned change to an existing step.
    - `existing` is only for steps the plan builds on unchanged, and they keep their anchors.
    - *design call:* this errs towards never showing intent as fact.
  - **Links:** a link is planned when either endpoint is planned or it sets `planned: true`. An example of the latter is an existing decision gaining a new branch to an existing step. Planned links need no anchor and are drawn like planned steps.
- **Anchors:** every step that is not `planned`, and every branch leaving a decision that is not `planned`, must have an anchor: `source` as `path:line` or `path:start-end`, or a **content anchor**: `source` as the path alone plus `match`, a piece of the line's text.
  - `match` is a plain substring (no regex), 1-200 characters, one line (a newline fails with `quote a single line`), no control or invisible characters except tabs, trimmed before validation and search. In JSON an inner tab must be written `\t` (a literal tab is a JSON parse error); leading indentation can simply be left out. It must occur on exactly one line of the file: not found is an error, and text on several lines is an error that lists the line numbers and asks for a more distinctive piece or the `path:line` form (owner decision, 2026-10-28; first-hit would anchor `return;` anywhere). The resolved line becomes the anchor (`path:line` in the snippet panel).
  - Content anchors exist so the agent can quote text it already read in the diff instead of re-reading files for line numbers, and they keep working when lines shift.
  - codechart refuses a spec that breaks this, with the one-line-per-error validation used for map specs.
- **Anchors are checked at render time:**
  - the file must exist, relative to the repo root, or failing that relative to the process cwd (retry-fixes round: agents run from a subdirectory and write cwd-relative paths); a cwd-relative hit is normalised to the repo-root path in snippets and HTML, and goes through exactly the same sandbox checks (real path inside the repo, not under `.git`, regular file, size caps). A path that exists in neither fails naming the repo root and, when exactly one tracked file ends with that path, `did you mean <path>`. With `--at` the same fallback applies to the commit's tree. The line range must be inside the file (or `match` must be on exactly one line of it);
  - the file is read through the same sandbox either way: its real path inside the repo root, not under `.git`, a regular file of at most 5 MB;
  - the repo root is the git root of the current directory, or the current directory outside git, the same as for `check` (*design call*);
  - a broken anchor is a validation error, not a warning.
  - `render --at <rev>` checks anchors against the files at that commit instead of the working tree, for summarising a commit or branch that isn't checked out (cost round, 2026-10-28). The revision gets the same validation as `check`'s git flags and is resolved to a commit. Files are read with `git ls-tree` + `git cat-file` (argument array, `--literal-pathspecs`), after the same lexical outside-repo and `.git` checks; symlinks, directories and blobs over 5 MB are refused, and a file missing at that commit is "does not exist at <sha>" (same cwd fallback and hint, from `git ls-tree`). Map specs ignore it.

  This stops typos and hallucinated paths; a content anchor also proves the quoted text exists. It doesn't prove the line does what the label says; the click-to-check panel (§9) covers that.
- **Gaps:** branches the agent suspects but didn't verify go into `gaps` ("didn't check what happens when the file is empty"). They are never drawn as branches.
- **Visual distinction:**
  - planned steps are dashed in the browser, and the terminal tree is titled `planned flow`;
  - in a mixed plan, planned steps carry a `?` marker in the terminal.
  - a `planned: true` link between two non-planned steps prints `?→`, and also titles the tree `planned flow`.
- **Skill rule:** draw only branches you saw in the code (summary) or are committing to build (plan). Anything else goes in `gaps`.

## 7. Flow spec (sketch)

```json
{
  "diagram": "flow",
  "kind": "summary",
  "title": "codechart render",
  "rules": ["behaviour-flow"],
  "start": "read",
  "steps": [
    { "id": "read", "label": "read file or stdin", "type": "step", "status": "existing", "source": "src/commands/render.ts:82" },
    { "id": "mode", "label": "output mode?", "type": "decision", "status": "changed", "source": "src/commands/render.ts:84-85" },
    { "id": "exit", "label": "exit, no output", "type": "end", "status": "existing", "source": "src/commands/render.ts:86" },
    { "id": "print", "label": "print terminal map", "type": "end", "status": "existing", "source": "src/commands/render.ts:104" }
  ],
  "links": [
    { "from": "read", "to": "mode" },
    { "from": "mode", "to": "exit", "label": "none", "source": "src/commands/render.ts:86" },
    { "from": "mode", "to": "print", "label": "cli", "source": "src/commands/render.ts:104" }
  ],
  "gaps": ["did not check behaviour when stdin is a TTY"]
}
```

- `type`: `step` | `decision` | `end`. A decision has ≥ 2 outgoing links, each with a `label`. Loops (links back to an earlier step) are allowed.
- `type` is optional (2026-10-28, cost round): left out, it is inferred from the step's outgoing links: 0 → `end`, 1 → `step`, 2 or more → `decision`. The inferred type goes through the same lints (an inferred decision still needs a `label` on each branch and an anchor on each non-planned branch). A step without `type` whose label ends in `?` and that has fewer than 2 outgoing links is an error: the label says decision, the links don't. An explicit `type` keeps today's link-count lints.
- Branch anchors are never inherited from the decision: every non-planned branch keeps its own anchor (owner decision, 2026-10-28).
- `diagram` defaults to `map`, so existing map specs stay valid; a spec with `steps` and no `diagram` is a flow.
- `codechart schema` prints both shapes.
- The exact field names are the builder's call. The rules in §6 are not.

## 8. When a flow is made

- **On request.** The user asks for it in their own words ("show me the flow", "I can't grasp the edge cases", "map how this works"). The skill tells the agent to write a flow spec and render it, with no rules involved.
- **Rules gain a `diagram` field** (`map` | `flow`, default `map`). *design call:* each diagram type resolves separately.
  - Rule matching works as today (first path match wins per file, `none` excludes its files), but **within one diagram type**.
  - So a map rule claiming a file never hides a flow rule on that file, and a map `none` rule doesn't stop flow judging.
  - `check`'s `final` becomes one entry per diagram type: `final: { map: { draw, output, context, rules }, flow: { draw, output, rules } }`.
  - **Flow rules have no context mode.** A flow is built from code the agent reads anyway, so there's nothing for a context mode to control.
  - Path rules can target flows too, e.g. "always draw a flow for `src/api/**`".
- **Built-in plain-language rule `behaviour-flow`** (`diagram: flow`, `output: auto`). `check` returns it in `toJudge` like any other plain-language rule.
- **`defaults.flows`: `auto` | `always` | `request`** (default `auto`) sets how high that rule's bar is:
  - **`auto`:** "the change adds or alters behaviour with at least 2 decisions or edge cases a reader would want to see".
  - **`always`:** "the change adds or alters any behaviour with at least one decision".
  - **`request`:** the built-in flow rule is off, so flows appear only when the user asks.

  Users who want finer control turn off the built-in rule and write their own.
- **`useBuiltinRules: false`** removes `behaviour-flow` like every other built-in rule (*design call*).
  - `defaults.flows` only adjusts that built-in rule, so it then has no effect.
  - Flows still come from the user's own rules or on request.
  - `codechart config` reports `defaults.flows` as "inactive (built-in rules off)".

## 9. Rendering

### Terminal: decision tree (chosen by the user, option B of the mockups)

```
read file or stdin → validate spec → load config
◇ output mode?
├─ none      → exit, no output
├─ cli       → print terminal map
├─ auto      → ◇ hidden nodes or ≥ 8 nodes?
│              ├─ no  → print terminal map
│              └─ yes → ⤷ write HTML
└─ web|both  → ⤷ write HTML

⤷ write HTML → prune old HTML → ◇ --open? yes → open browser
           → print map or link
```

- **Straight runs:** a run of plain steps sits on one line, joined with `→`.
- **Decisions:** a decision is `◇ label`, with its branches indented under it using tree glyphs and each branch label aligned.
- **Shared steps:**
  - a step reached from more than one place (a merge point or a loop target) is printed once as its own block, starting with `⤷ label`;
  - every place that reaches it shows `⤷ label`;
  - loops use the same notation.
- **Status markers:** `+`, `~` and `?` (planned), the same idea as map prefixes. `existing` has no marker. Color follows the map rules (TTY only).
- **Width:** every line fits `width`. Long labels are truncated with `…`, and the full label is in the web view.
- **Footer:** a step count with new, changed and planned counts, then gaps, then the `full map → file://…` link when HTML was written.
- **`render --md`** works the same as for maps: a constant header line `**Flow** _(key: + new  ~ changed  ? planned  ◇ decision  ⤷ shared step)_`, then a fenced `text` block that opens with the title (truncated to the width with `…`) underlined by `─` and holds the tree (with output `web`, the title only), a blank line, then `[Open full map](…)` when HTML was written. The agent pastes it verbatim. The title lives inside the fence because agents "fixed" the escaped title in a header line when pasting; inside the fence it needs no escapes and none of its Markdown takes effect.
- **Width:** the same rules as maps: a minimum of 20 columns, and `$COLUMNS` or 80 when not a TTY. With `auto`, the HTML is also written whenever the tree had to cut text or prune branches.
- **Size rule** (same budget as maps, `terminalMaxNodes`):
  - when the flow is within the budget, the full tree is printed;
  - when it's over, a **preview** is printed: the tree is walked from `start` in order until the budget runs out, and each branch that was cut is shown as `… (+N steps in web view)`;
  - when not even the start run and the first decision fit, only the link is printed.

### Web: flowchart

- Top-down ELK layered layout, the same engine as maps.
- **Shapes:** rectangles for steps, diamonds for decisions, rounded pills for ends, and labelled arrows.
- **Planned steps:** dashed outline and a "planned" badge.
- **Click a step:** a side panel shows its status, its `source` as `path:line` (for a content anchor, the line `match` resolved to), and the **code snippet** at that range (one line for a content anchor), read from disk at render time (up to 15 lines, each cut at 300 characters so a minified line can't flood the panel), so the user can check the anchor in seconds.
- Same themes, toggle, pan/zoom, gaps list and self-contained single file as maps.

## 10. Agent integration (skill changes)

- Recognise flow requests in the user's own words. The skill description gains real phrases: "show me the flow", "how does this work", "walk me through the logic", "what are the edge cases", "what happens when…", "draw the decision flow".
- Decide whether a flow is due from the per-rule fields in `check`'s output; `final` appears only without plain-language rules (see design.md, "Deciding without `final`").
- A separate `flow-guide.md` covers steps, decisions, anchors, `planned`, and what goes in `gaps`, with a worked example, like `spec-guide.md` does for maps.
- Write one flow spec per behaviour.
- Follow the trust rules in §6. The skill states them as hard rules, next to "never invent fields".
- Paste the terminal output verbatim, as for maps.

## 10b. Lessons from map dogfooding, applied to flows

- **Enforce in the CLI, not in prose.** Agents don't reliably follow layout or labelling instructions. Anchors, statuses, the `planned` rules and readable labels are validation errors, and the reply block comes from `render --md`.
- **One representation per idea.** The tree is the only terminal form, with no legend or second section.
- **Plain markers, no emoji.** The user found emoji icons cluttered.
- **Test with fresh agents before shipping the skill changes,** on the scenarios: a flow on request, auto after a logic change, a plan with planned branches, and a trivial change (no flow).

## 11. Decisions

| Decision | Made by |
|---|---|
| Add flow maps of how code behaves, alongside relationship maps | User |
| On request, plus auto (agent judges if worth it, default), plus always via config | User |
| Flows for plans and for change summaries | User |
| Output follows the map rules (terminal if it fits, preview plus link, link only) | User |
| Terminal format: indented decision tree with `◇` decisions and `⤷` shared steps (option B) | User |
| An invented branch is the worst failure; an unnecessary tree is acceptable | User |
| Anchors required for every non-planned step and branch, checked against the files at render time | design call |
| Content anchors (`source` path + `match`) alongside `path:line`; a `match` on more than one line is an error, never first-hit | User (2026-10-28) |
| Map specs get no `match`: map nodes carry a file `path`, never a line anchor | design call |
| `render --at <rev>` (anchors read from a commit via git) instead of a skill rule to re-anchor on current files: keeps a commit summary's anchors true to that commit | design call (cost review fix) |
| `planned` status for plan specs; dashed in the web view, `?` in the terminal | design call |
| Unverified branches go to `gaps`, never drawn | design call |
| Separate flow spec shape (`diagram: "flow"`), one behaviour per spec | design call |
| `auto` implemented as a built-in plain-language rule; `defaults.flows` adjusts its bar | design call |
| Code snippet in the web panel, read from the anchor at render time | design call |
| ~~Built after v1 ships~~ → built **before** the v1 release | User (2026-10-28) |
| Each diagram type resolves its rules separately; `final` has one entry per type | design call |
| Plan specs allow only `existing` and `planned`; links can be planned | design call |

## 12. Open risks

- **Anchors prove location, not meaning.** A correct `file:line` with a wrong label still misleads. Mitigation: the snippet panel and the skill rule. Accepted.
- **Plan flows mix intent and fact.** The `planned` marking must stay visually unmistakable in both views.
- **Agent judgement on "worth it" varies between runs.** Accepted, as for other plain-language rules. The user prefers an extra tree over a missing one.
- **Deep or looping flows in the terminal.** The preview cut has to stay readable. To be checked against real flows during dogfooding.

## 13. Left to the builder

Exact spec field names, the tree-drawing algorithm (choosing the main path and the order of shared blocks), ELK options for the flowchart, snippet styling, and snippet details.
