# Writing a codechart flow spec

Run `codechart schema --flow` for the exact JSON Schema. This guide is about choosing what goes in.

A flow shows **one behaviour** (a command, endpoint, job or handler): its steps, decisions and labelled branches. Several behaviours → several small specs, one `render` call each, never one huge flow.

## Trust rules (hard)

An invented branch is the worst failure: it destroys the user's trust in the tool.
- Draw only branches you saw in the code (summary) or are committing to build (plan).
- A branch you suspect but didn't verify goes in `gaps` (`"did not check what happens when the file is empty"`), never on the flow.
- Never present intended behaviour as existing: in a plan, anything the plan adds or alters is `planned`.

## Steps

- `type`: `step` (does something), `decision` (a question the code branches on, label ends in `?`), `end` (returns, raises, exits). Leave it out and it is inferred from the outgoing links: none → `end`, one → `step`, two or more → `decision`. A label ending in `?` with fewer than 2 links fails the render. `diagram: "flow"` is inferred from `steps` too.
- `label`: verb + object, aim for 30 characters or fewer (`look up invite by token`, `expired?`), not a sentence or a function name. Longer labels are cut at the terminal width; details belong in your prose or the anchored code. One action per step: ` / ` or ` + ` fails validation. Step and link labels are plain words, never code: quotes, a call with arguments, `[...]` with something inside, `=` or `...` fails validation (`reads as code`); rename it and render again.
- **No hidden decisions:** a label with "if", "else", "or" or `;` hides a branch. Make it a decision with labelled branches, or put it in `gaps` if you didn't verify it.
- Decision labels are unique: one decision per question; if two really differ, say how (`map spec?`, `flow anchors valid?`).
- `start`: the id of the first step.
- The decisions are the edge cases. Collapse straight-line bookkeeping into one step. Over ~15 steps: split into several flows, or the terminal shows only a preview.

| Status | Summary (`kind: summary`) | Plan (`kind: plan`) |
|---|---|---|
| `existing` | untouched by the change | built on unchanged; keeps its anchor |
| `new` | added by the change | rejected |
| `changed` | altered by the change | rejected |
| `planned` | rejected | anything the plan adds or alters, including a change to an existing step (keep its anchor then) |
| `removed` | rejected | a step the plan deletes; keeps its anchor, since the code exists now |

## Links

- Only a `decision` branches: a `step` has at most 1 outgoing link, an `end` none.
- `{ "from", "to" }`; a link leaving a decision also needs a `label` (`yes`, `no`, `none`, `cli`). A decision has at least 2 outgoing links. Loops back to an earlier step are allowed.
- A link is planned when either end is `planned`, or it sets `"planned": true` (a plan adds a new branch between existing steps, or a new link into a step it alters).
- In a plan, keep every link that exists now. One the plan drops between steps that stay sets `"removed": true` (with its anchor, if it leaves a decision); links to a `removed` step are removed without it. A step's shape (step, decision, end) follows the flow after the plan.
- A plan that removes something or alters an existing step (a `planned` step with a `source`) is drawn in the HTML as **Now** and **After plan** side by side.

## Anchors

- `source` is `path:line`, `path:start-end`, or the path alone plus `match`: a piece of the line's text (plain substring, no regex, trimmed). Leave out leading indentation; inside JSON an inner tab must be written `\t`, or pick a piece without one. Paths are relative to the repo root (a path that exists only relative to your cwd is accepted and shown repo-root relative) and must be inside the repo. Point at the line that does the step or makes the branch.
- Prefer `match` when you have the text in front of you (a diff, a file you read): copy a distinctive piece of the line, no need to look up line numbers. It must be on exactly one line of the file; on several, `render` lists their numbers: quote a more distinctive piece, or drop `match` and use source `path:line`. Use `path:start-end` for a block (the click panel shows up to 15 lines; a `match` shows one).
- Anchors are read from the working tree. For a commit or branch that isn't checked out, render with `--at '<sha or branch>'` so they are read from that commit instead; otherwise lines that changed since won't resolve.
- Required on every non-planned step and every non-planned link leaving a decision, each with its own anchor (a branch never inherits the decision's). Planned steps and links need none.
- `render` checks every anchor against the files. A broken anchor fails the render: reread the file and fix the line, never drop the anchor or mark the step `planned` to get past it.
- Rendered with `--git`, `--since` or `--commit`, a summary's `new` or `changed` step whose file isn't in the diff gets a `✗` line (the render still succeeds; `--strict` exits 1).
- Read the code you draw: flows have no context mode, and every anchor must be a line you actually saw.

## Drift from the plan

A summary written after a plan in this repo is compared with that plan (plans are kept a week, per branch; compared only when the summary's range starts at or before the plan's commit, and a summary with no diff flag always is). Reuse the plan's step ids so steps match; one with the same `source` (and `match`) matches too. Note the reason when you deviate, then list each deviation in the summary's `drift` (a plan rejects `drift`):

```json
"drift": [{ "step": "revoked", "cause": "cleaner-way", "why": "Checking expiry and revocation separately meant two database reads. Revocation is now part of the expiry check, so a revoked invite fails there with the same error." }]
```

- `cause`: `bug-found`, `wrong-assumption`, `user-asked`, `cleaner-way`, `out-of-scope`, `other`. `why`: the detailed reason the user reads when they open it, 1-3 plain sentences (max 400 characters): what you found, what you did instead, what it means for them. No jargon or ids.
- Drifts: a `planned` step not built (or left `existing`), a `removed` step still there, a built `new` or `changed` step the plan lacks (or a `new` one it kept `existing`), a `changed` step the plan kept `existing`, or a planned link between built steps that isn't there.
- A drift without an entry prints `✗ … no reason given` (`--strict` exits 1); an entry for a step that didn't drift is a warning.

## Rules and gaps

- `rules`: the names of the rules that made you draw the flow (from `check`). For a flow the user asked for, leave `rules` out. Naming a map rule in a flow spec (or a flow rule in a map spec) is rejected.
- A user rule replacing `behaviour-flow` in `.codechart.yaml` needs `diagram: flow`, or it acts on maps.
- `gaps`: unverified branches, code you didn't read, and anything you didn't run or check yourself (e.g. "tests not run"). If your prose admits it, it belongs in `gaps`. Findings and risks go in your prose.

## Example (summary)

The change added `POST /invites/{token}/accept` in `app/api/invites.py`. Every step has an anchor, and so does every link leaving a decision; only plain step-to-step links (`lookup → found`) go without. `type` is left out (inferred from the links), and every anchor is a `match` except the `join` block, which uses a line range:

```json
{
  "kind": "summary", "title": "Accept a team invite", "rules": ["behaviour-flow"], "start": "lookup",
  "steps": [
    { "id": "lookup", "label": "look up invite by token", "status": "new", "source": "app/api/invites.py", "match": "invite = find_invite(token)" },
    { "id": "found", "label": "invite found?", "status": "new", "source": "app/api/invites.py", "match": "if invite is None:" },
    { "id": "404", "label": "404 invite not found", "status": "new", "source": "app/api/invites.py", "match": "raise NotFound(\"invite\")" },
    { "id": "expired", "label": "expired?", "status": "new", "source": "app/api/invites.py", "match": "if invite.expires_at < now():" },
    { "id": "410", "label": "410 invite expired", "status": "new", "source": "app/api/invites.py", "match": "raise Gone(" },
    { "id": "member", "label": "already a member?", "status": "new", "source": "app/api/invites.py", "match": "if is_member(user, invite.team):" },
    { "id": "noop", "label": "return already a member", "status": "new", "source": "app/api/invites.py", "match": "return {\"status\": \"member\"}" },
    { "id": "join", "label": "save membership", "status": "new", "source": "app/api/invites.py:10-12" },
    { "id": "joined", "label": "return joined", "status": "new", "source": "app/api/invites.py", "match": "return {\"status\": \"joined\"}" }
  ],
  "links": [
    { "from": "lookup", "to": "found" },
    { "from": "found", "to": "404", "label": "no", "source": "app/api/invites.py", "match": "raise NotFound(" },
    { "from": "found", "to": "expired", "label": "yes", "source": "app/api/invites.py", "match": "if invite.expires_at < now():" },
    { "from": "expired", "to": "410", "label": "yes", "source": "app/api/invites.py", "match": "raise Gone(" },
    { "from": "expired", "to": "member", "label": "no", "source": "app/api/invites.py", "match": "if is_member(user, invite.team):" },
    { "from": "member", "to": "noop", "label": "yes", "source": "app/api/invites.py", "match": "return {\"status\": \"member\"}" },
    { "from": "member", "to": "join", "label": "no", "source": "app/api/invites.py", "match": "m = Membership(" },
    { "from": "join", "to": "joined" }
  ],
  "gaps": ["did not check what happens when two requests accept the same invite at once"]
}
```

`render --md --git` prints this (paste your own output verbatim; the real link path comes from it):

````
**Flow** _(key: + new  ~ changed  ? planned  ◇ decision  ⤷ shared step)_
```text
Accept a team invite
────────────────────
+look up invite by token
◇ +invite found?
├─ no  → +404 invite not found
└─ yes → ◇ +expired?
         ├─ yes → +410 invite expired
         └─ no  → ◇ +already a member?
                  ├─ yes → +return already a member
                  └─ no  → +save membership → +return joined

9 steps · 9 new · 0 changed · 0 planned · ✓ 15 anchors checked
gaps: did not check what happens when two requests accept the same invite at
      once
```

[Open full map](file://<absolute path>)
````

## Example (plan)

A plan to reject revoked invites in that endpoint: the steps above become `existing` (anchors kept), and the new branch is `planned`, with no `source`:

```json
{ "id": "revoked", "label": "revoked?", "status": "planned" },
{ "id": "403", "label": "403 invite revoked", "status": "planned" }
```

Links: `expired → revoked` (`no`) replaces `expired → member`, so keep `expired → member` with `"removed": true` (and its anchor); add `revoked → 403` (`yes`) and `revoked → member` (`no`). The three new ones are planned because `revoked` is. The HTML shows today's flow next to the one after the plan.
