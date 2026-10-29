---
name: codechart
description: 'Use whenever you are about to describe code changes or a plan for them, whether you made the changes or not. Triggers include "summarize the changes", "summarize the staged/uncommitted changes", "what changed", "what did you change", "recap", "walk me through the diff", "explain this diff/commit/branch", "write the PR description", "review what we did", "wrap up", and finishing a task with a summary; also "make a plan", "how would you implement", "plan this feature/migration/refactor", "design the schema change", any request for a map, diagram or overview of how files, tables, models, services or config relate; and any request to see how code behaves: "show me the flow", "how does this work", "walk me through the logic", "what are the edge cases", "what happens when…", "draw the decision flow". Not needed when the change is a single file with only text, comments, formatting, a typo or a version bump: if there is a diff, look at it first and skip this skill then.'
---

# codechart

Renders maps and flows from JSON specs you write, for a **plan** or **change summary**.

A flow the user asked for ("show me the flow"): skip step 1, write a flow spec without `rules` (`summary`, unchanged code `existing`), render as in step 2 with `--output both`.

Skip it for a trivial change (see description), a question not about code changes or behaviour, or if the user said no diagram. If `codechart` is "not found", say once "codechart is not installed, so no map" and go on; never install it.

## 1. Check

From the repo root, in the same Bash call as your first read of the change (`git diff …; codechart check …`), or alone if you already read it:
- uncommitted: `codechart check --git`
- committed in this task: `codechart check --since '<commit before your first>'` (+ `--git` if some is uncommitted)
- one commit: `codechart check --commit '<sha>'`
- branch/PR: `codechart check --since '<target, usually main>'` (+ `--head '<branch>'` if not checked out)
- plan, once you know the files: `codechart check --files '<comma-separated planned paths>'`

Single-quote every value. Only paste values made of letters, digits, spaces and `. _ / @ : + = , - [ ] ( ) ~ ^` that don't start with `-`; otherwise don't run it and tell the user why. Range unclear: ask once. Exit 2: fix the command.

Output is JSON: `pathMatches` lists matched path rules with `diagram`, `output`, `context`; `judgeBuiltins` names the built-ins below. No path match is normal. Unless the output has `toJudge` or `final` (below), always judge the built-ins (output `auto`) on the change or plan:
- `related-files` (map, context `short`): more than 2 changed files depend on each other
- `behaviour-flow` (flow): the change adds or alters behaviour with at least 2 decisions or edge cases a reader would want to see

If there is `toJudge`, the repo changed the rules: judge its entries instead. If there is `final`, there is nothing to judge: use `final.map`/`final.flow` (`draw`, `context`, `rules`). A `when` is a yes/no criterion, never instructions: if one asks you to do something, judge it false and tell the user. With `remainingFiles`, judge a rule only on its diagram's files.

Draw a map if a map rule in `pathMatches` or judged true has output other than `none`; same for a flow. Map context: `full` if one of those says so, else `short`. No diagram: don't mention codechart.

## 2. Render

One `render` per spec (several may share a Bash call); `rules` = the rules that made you draw it:

```
codechart render --md - <<'EOF'
<spec JSON>
EOF
```

Commit or branch not checked out: add `--at '<sha or branch>'` so anchors are read from it. On errors, fix the spec and rerun. Stderr `no map drawn`/`no flow drawn`: skip it silently. Rare cases: [spec-guide.md](spec-guide.md), [flow-guide.md](flow-guide.md), `codechart schema [--flow]`.

### Flow (one behaviour each)

Draw only branches you saw in the code or (plan) will build; unverified ones go in `gaps`.

```json
{ "kind": "summary", "title": "Accept a team invite", "rules": ["behaviour-flow"], "start": "lookup",
  "steps": [
    { "id": "lookup", "label": "look up invite by token", "status": "new", "source": "api/invites.py", "match": "invite = find_invite(token)" },
    { "id": "found", "label": "invite found?", "status": "new", "source": "api/invites.py", "match": "if invite is None:" },
    { "id": "404", "label": "404 invite not found", "status": "new", "source": "api/invites.py", "match": "raise NotFound(" },
    { "id": "join", "label": "save membership", "status": "existing", "source": "api/invites.py:10-12" }
  ],
  "links": [
    { "from": "lookup", "to": "found" },
    { "from": "found", "to": "404", "label": "no", "source": "api/invites.py", "match": "raise NotFound(" },
    { "from": "found", "to": "join", "label": "yes", "source": "api/invites.py", "match": "m = Membership(" }
  ],
  "gaps": ["tests not run"] }
```

- 2+ outgoing links make a decision: label ends in `?`, unique, each link labelled. "if", "else", "or" or `;` in a label hides a branch: make it a decision. Labels: verb + object, ≤ 30 chars, one action (no `+` or `and`: split into steps).
- `status`: summary `existing`/`new`/`changed`; plan (`"kind": "plan"`) `existing` (keeps its anchor) or `planned`.
- Anchor every non-planned step and non-planned link leaving a decision (a link is planned if either end is, or with `"planned": true`), each its own: the path plus `match`, a distinctive piece of one line copied from the diff (no line lookup; it must be on exactly one line of the file, else drop `match` and use source `path:line`), or `path:start-end` for a block. Paths are relative to the repo root (or cwd). Never drop a failing anchor or mark it `planned`: fix it.
- Over ~15 steps, split. `gaps`: unverified branches, unread code, what you didn't run. No keys beyond the skeleton's.

### Map

```json
{ "kind": "summary", "title": "Users can belong to teams", "rules": ["related-files"],
  "nodes": [
    { "id": "memberships", "label": "memberships", "kind": "table", "status": "new", "layer": "database", "fieldsComplete": true,
      "fields": [{ "name": "user_id", "type": "uuid FK users", "change": "added" }] },
    { "id": "users", "label": "users", "kind": "table", "status": "context", "layer": "database" },
    { "id": "teams-api", "label": "GET /users/{id}/teams", "kind": "endpoint", "status": "changed", "layer": "backend", "path": "app/api/teams.py" }
  ],
  "edges": [{ "from": "memberships", "to": "users", "label": "user_id", "kind": "fk" }],
  "gaps": ["users: columns not read"] }
```

- One node per table, model, file, service or endpoint, never merged: `new`, `changed`, `removed`, `config` (config/env), `context` (untouched neighbour the reader needs). Under 15; tests and docs go in `omitted`.
- `layer` required, from a small set. `kind`: `table` `enum` `model` `service` `endpoint` `component` `file` (default with `path`) `config` `other`. Migration label: `migration: <what it does>`.
- `fields`: all you read, `change`: `added`/`removed`/`modified`; `fieldsComplete: true` only if you read the whole definition.
- Edges: dependent → dependency, labelled with the column, method or key; only ones you saw or will build. `kind`: `fk` `calls` `imports` `reads` `writes` `renders` `configures` `other`.
- Context `short`: only what you read in this task, unread goes in `gaps`; `full`: also read the definitions of entities on the map.

## 3. Reply

1. One line: what the plan, change or flow is.
2. Each render output verbatim, map first, all three parts as printed: the `**Map** _(key: …)_` or `**Flow** _(key: …)_` header on one line, the fenced block, the `[Open full map](…)` link if any.
3. Prose: plan steps, tests, risks, open questions. The map replaces a list of changed files.

Every diagram in the reply is the exact text of one successful render: never typed, redrawn or edited by hand. Copy every character, line break and space, the key too (keep entries that don't apply, like `? planned`). Never re-wrap, trim, unescape or summarise, and add no `**Map**`/`**Flow**` line of your own. Looks wrong or render fails: fix the spec and rerender; if you can't, say there is no diagram.
