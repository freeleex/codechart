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
- `label`: verb + object, aim for 30 characters or fewer (`look up invite by token`, `expired?`), not a sentence or a function name. Longer labels are cut at the terminal width; details belong in your prose or the anchored code. One action per step: ` / ` or ` + ` fails validation.
- **No hidden decisions:** a label with "if", "else", "or" or `;` hides a branch. Make it a decision with labelled branches, or put it in `gaps` if you didn't verify it.
- Decision labels are unique: one decision per question; if two really differ, say how (`map spec?`, `flow anchors valid?`).
- `start`: the id of the first step.
- The decisions are the edge cases. Collapse straight-line bookkeeping into one step. Over ~15 steps: split into several flows, or the terminal shows only a preview.

| Status | Summary (`kind: summary`) | Plan (`kind: plan`) |
|---|---|---|
| `existing` | untouched by the change | built on unchanged; keeps its anchor |
| `new` | added by the change | rejected |
| `changed` | altered by the change | rejected |
| `planned` | rejected | anything the plan adds or alters, including a change to an existing step |

## Links

- Only a `decision` branches: a `step` has at most 1 outgoing link, an `end` none.
- `{ "from", "to" }`; a link leaving a decision also needs a `label` (`yes`, `no`, `none`, `cli`). A decision has at least 2 outgoing links. Loops back to an earlier step are allowed.
- A link is planned when either end is `planned`, or it sets `"planned": true` (a plan adds a new branch between existing steps).

## Anchors

- `source` is `path:line`, `path:start-end`, or the path alone plus `match`: a piece of the line's text (plain substring, no regex, trimmed). Leave out leading indentation; inside JSON an inner tab must be written `\t`, or pick a piece without one. Paths are relative to the repo root (a path that exists only relative to your cwd is accepted and shown repo-root relative) and must be inside the repo. Point at the line that does the step or makes the branch.
- Prefer `match` when you have the text in front of you (a diff, a file you read): copy a distinctive piece of the line, no need to look up line numbers. It must be on exactly one line of the file; on several, `render` lists their numbers: quote a more distinctive piece, or drop `match` and use source `path:line`. Use `path:start-end` for a block (the click panel shows up to 15 lines; a `match` shows one).
- Anchors are read from the working tree. For a commit or branch that isn't checked out, render with `--at '<sha or branch>'` so they are read from that commit instead; otherwise lines that changed since won't resolve.
- Required on every non-planned step and every non-planned link leaving a decision, each with its own anchor (a branch never inherits the decision's). Planned steps and links need none.
- `render` checks every anchor against the files. A broken anchor fails the render: reread the file and fix the line, never drop the anchor or mark the step `planned` to get past it.
- Read the code you draw: flows have no context mode, and every anchor must be a line you actually saw.

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

`render --md` prints this (paste your own output verbatim; the real link path comes from it):

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

9 steps · 9 new · 0 changed · 0 planned
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

Links: `expired → revoked` (`no`) replaces `expired → member`; add `revoked → 403` (`yes`) and `revoked → member` (`no`). All three are planned because `revoked` is.
