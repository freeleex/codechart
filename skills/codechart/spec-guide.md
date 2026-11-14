# Writing a codechart spec

Run `codechart schema` for the exact JSON Schema. This guide is about choosing what goes in.

## Nodes: what to include

Include one node per thing the reader needs to understand the change:

| Include | Status |
|---|---|
| Every table, enum, model, service, endpoint, component or file the change adds | `new` |
| Every one it modifies | `changed` |
| Every one it deletes (a dropped table, a deleted model, file or endpoint). Keep its edges as they were before the change, so the reader sees what loses the link | `removed` |
| Config values and env vars it adds or reads (settings, deploy values, env vars) | `config` |
| **Untouched neighbours**: anything a new or changed node points at or is pointed at by, that the reader needs to place the change. Example: a new table `memberships` with FKs to `users` and `teams` → include `users` and `teams` as `context` even though you didn't touch them | `context` |

Rules:
- **One node per table, model, file, service or endpoint.** Never merge several into one node: `"label": "Team / User / Project"` is wrong; that is three model nodes. A label containing ` / ` or ` + ` fails validation (`one node per entity; split ...`).
- A table and the ORM model that maps it are two nodes (`kind: table` and `kind: model`), joined by an edge labelled `maps`. Include both when both change.
- A migration is a `file` node with edges to the tables it creates or alters (`creates`, `alters`, `backfills`). Its label says what it does, `migration: add invoices`, never its file name or revision hash (`a91f0c2e7b45_add_invoices` is noise to the reader, and a label with a hash-like hex token (e.g. `a91f0c2e7b45`) fails validation: `looks like a hash or file name`); put the file name in `path`.
- A removed node lists no fields; deleting one field of a surviving table is `changed` with `"change": "removed"` on that field, not a `removed` node. Example: dropping the `legacy_roles` table that `users` pointed at:
  ```json
  { "id": "legacy-roles", "label": "legacy_roles", "kind": "table", "status": "removed", "layer": "database" }
  ```
  with `users` as `changed` (its `legacy_role_id` field `"change": "removed"`) and the old edge `users → legacy-roles` kept.
- Leave out tests, docs and lock files; list them in `omitted` instead (`"tests: test_teams.py"`). With a diff flag, `render` flags every changed file that no node's `path` covers (a folder path covers the files under it) and no `omitted` entry names by repo path, file name, `folder/` or glob. Lockfiles, generated files and files a map rule sends to output `none` are never flagged. When a whole group is deliberately off the map (too many files to draw), say what they are and why before the paths (`"frontend pages and components calling telemetry: frontend/src/pages/"`): the page draws the entry as a dashed `omitted` box in that area, with the changed files it covers in its panel. A bare `tests:` or `docs:` list stays in the page's *Not on map* list.
- Don't add a node you can't describe from what you read. Put it in `gaps`.
- In a plan, name files the repo's way (look at neighbouring files for naming and numbering); they are shown as `new`.
- Aim for under 15 nodes. More than that: drop the least connected `context` nodes and mention them in `omitted`.

## Node fields

```json
{ "id": "users", "label": "users", "kind": "table", "status": "changed", "layer": "database",
  "summary": "application users, each in one team", "path": "app/models/user.py",
  "fieldsComplete": true,
  "fields": [
    { "name": "id", "type": "uuid PK" },
    { "name": "email", "type": "text unique" },
    { "name": "team_id", "type": "uuid FK teams", "change": "added" }
  ] }
```

- `id`: short, stable, unique (`users`, `team-model`). Edges refer to it.
- `label`: what the reader knows it by, kept short (`users`, `Team`, `DEFAULT_CURRENCY`). For files, the short name, not the full path (the path goes in `path`).
- `kind`: table, enum, model, service, endpoint, component, file, config, other. Defaults to `file` when `path` is set, so a plain file node needs only `path`.
- `layer`: free text, one per area: `database`, `backend`, `frontend`, `config`, `ci`. Nodes in a layer are drawn together, so keep the set small and consistent.
- `summary`: **every node gets one**: one or two plain sentences on what it does, its role in the flow or system (not what changed). The page shows it at the top of the node's panel and inside its box; a box without one reads as an empty outline.
- `fields`: for tables, models and enums: **every** field you read, not only the changed ones. Mark changes with `change` (added, removed, modified); leave unchanged fields unmarked. On a `modified` field, `was` is the old type when the type changes (`"type": "enum", "was": "text"`). In `short` mode only fields you actually read; in a plan, the fields you are committing to build are always listed (they are the plan).
- `match` (optional, needs `path`): a distinctive piece of one line in that file, copied from the diff, like a flow anchor. It must be on exactly one line. The HTML shows the line in the node's panel; the terminal doesn't.
- `fieldsComplete`: required on every node with `fields`.
  - `true`: you read the whole definition (model, table or enum) and listed every field.
  - `false`: you list only what you saw, such as the changed columns in a migration. The map then says only some fields are shown.
  - In `full` context, open the definition so you can list every field and set `true`.

## Infrastructure

Terraform, OpenTofu, Terragrunt, Helm, Kustomize and Kubernetes files match the built-in `infrastructure` rule. No special kinds:

| Thing | Node |
|---|---|
| Resource or data source | `kind: other`, label as the code names it (`aws_s3_bucket.logs`), `path` its `.tf` file, `match` its block line (`resource "aws_s3_bucket" "logs"`) |
| Module call | `kind: other`, label `module.vpc`, `path` the file with the `module` block, `match` its line (`module "vpc"`) |
| Local module's code, when the change edits it | `kind: file`, label `modules/vpc`, `path` its folder |
| Kubernetes object (manifest or Helm template) | `kind: other`, label `Deployment api`, `path` its file |
| Chart | `kind: file`, label `chart: api`, `path` its folder |
| Variable, output, tfvars or values key, ConfigMap or Secret | `kind: config`, status `config` |

- `layer` by role: `network`, `compute`, `storage`, `iam`, `dns`, `config`; not by file or environment.
- Edges: dependent → dependency, labelled with the attribute that refers (`vpc_id`, `role`, `serviceName`). `reads` for a reference or a variable, `configures` for values or inputs fed into a module or template, `other` for `depends_on`.
- `fields`: the attributes you changed or that matter, with `was` on a changed value (`"name": "instance_type", "type": "t3.small", "change": "modified", "was": "t3.micro"`); `fieldsComplete: false` unless you listed the whole block.
- `gaps`: resources and remote modules you didn't read, and `terraform plan not run` (you can't tell an in-place update from a replacement without it). A rename or a replacement you did spot is a risk for your prose.

```json
{ "kind": "summary", "title": "Access logs bucket for the load balancer", "rules": ["infrastructure"],
  "nodes": [
    { "id": "logs", "label": "aws_s3_bucket.logs", "kind": "other", "status": "new", "layer": "storage", "path": "infra/logs.tf", "match": "resource \"aws_s3_bucket\" \"logs\"", "summary": "S3 bucket the load balancer writes its access logs to; objects expire after 30 days." },
    { "id": "alb", "label": "aws_lb.api", "kind": "other", "status": "changed", "layer": "network", "path": "infra/alb.tf", "fieldsComplete": false, "summary": "Public load balancer in front of the API service; now keeps access logs.",
      "fields": [{ "name": "access_logs.enabled", "type": "true", "change": "modified", "was": "false" }] },
    { "id": "retention", "label": "var.log_retention_days", "kind": "config", "status": "config", "layer": "config", "path": "infra/variables.tf", "summary": "How many days the access logs are kept before S3 deletes them." }
  ],
  "edges": [
    { "from": "alb", "to": "logs", "label": "access_logs.bucket", "kind": "reads" },
    { "from": "logs", "to": "retention", "label": "expiration.days", "kind": "reads" }
  ],
  "gaps": ["terraform plan not run"] }
```

## What `render` checks

A `✗` mismatch fails the check and `--strict`; a `⚠` warning never fails it. Each mismatch is named at the top of the output.

- **File exists:** every node with a `path`, except a summary's `removed` node (a class deleted from a file that stays) and a plan's `new` node (not built yet). A folder counts. A node without a `path` is counted as not checkable.
- **In the diff:** in a summary rendered with `--git`, `--since` or `--commit`, every `new`, `changed` or `removed` node's file, with git's status: `new` needs a file git adds, `removed` one it deletes, and `changed` one it modifies or renames. `context` and `config` nodes are not checked against the diff.
- **`match`:** found on exactly one line, when the file must exist.
- **Fields and arrows (warning):** each listed field must appear in its file (a dotted name such as `access_logs.bucket` may be a nested block, its parts in order), and an arrow's source file should mention the other box's name (`module.vpc`, `store.FindOrder`; for `Deployment api`, `api`) or its file's name (an `index` file's folder too); two boxes in one file are checked by name only. Comparison ignores case, `_` and `-`; a miss is a `⚠` warning, never a `✗`.

## Drift from the plan

A summary written after a plan in this repo is compared with that plan (plans are kept a week, per branch; compared only when the summary's range starts at or before the plan's commit, and a summary with no diff flag always is). Reuse the plan's node ids so nodes match; one with the same `path` matches too. Note the reason when you deviate, then list each deviation in the summary's `drift` (a plan rejects `drift`):

```json
"drift": [{ "node": "memberships", "cause": "bug-found", "why": "Testing showed a user could join the same team twice. A unique index on user and team now stops that, so a repeated join request is rejected." }]
```

- `cause`: `bug-found`, `wrong-assumption`, `user-asked`, `cleaner-way`, `out-of-scope`, `other`. `why`: the detailed reason the user reads when they open it, 1-3 plain sentences (max 400 characters): what you found, what you did instead, what it means for them. No jargon or ids.
- Explain map (a map of existing code, see [explain-guide.md](explain-guide.md)): `"kind": "explain"`, statuses `existing` and `outside` only; they are invalid in a plan or summary, and an explain map has no `new`, `changed`, `removed`, `config` or `context` boxes, edge or field `change`, `drift` or `omitted`; it may carry `flows` (step-by-step behaviours, which no plan or summary takes).
- Drifts: a planned `new`/`changed`/`removed`/`config` node not built, a built one not planned, one built with another path, status or changed fields (name, `change`, type), or a planned `"change": "added"` edge between built nodes that isn't there. Labels, summaries and notes never count; `context` nodes are ignored.
- A drift without an entry prints `✗ … no reason given` (`--strict` exits 1); an entry for a node that didn't drift is a warning.

## Edges

```json
{ "from": "users", "to": "teams", "label": "team_id", "kind": "fk" }
```

- Direction: from the thing that depends to the thing it depends on (FK holder → referenced table; caller → callee; reader → config).
- `label`: the column, method or key that makes the link, in plain words (`team_id`, `list_projects()`, `reads DEFAULT_CURRENCY`, `additional_training (now a list)`). Short. Never a code expression from the diff: a node or edge label with quotes, a call with arguments, `[...]` with something inside, `=` or `...` fails validation (`reads as code`); rename it and render again.
- `kind`: fk, calls, imports, reads, writes, renders, configures, other. Use `writes` for a migration that creates or alters a table, and `other` for a model's `maps` edge to its table.
- Only edges you saw in code, or (in a plan) ones you are committing to build.
- In a plan, `change` marks a link that moves between nodes existing before and after: `"added"` for one the plan builds, `"removed"` for one it drops. Leave it out on edges to a `new` or `removed` node; their status already says it. The HTML then shows the plan as Now and After side by side.

## gaps vs omitted vs your prose

| Goes in | What |
|---|---|
| `gaps` | What you did **not** read or do not know: `"users: relations to other tables not read"`, `"migration: downgrade not checked"`. A partial field list is not a gap: set `fieldsComplete: false` instead. Only real unknowns: if you read everything relevant, leave it empty. Never list something you did read: if you saw the migration has no downgrade, that is a finding for your prose, not `"downgrade not checked"`. In a plan, also open decisions that change the map (`"teams: extra columns not decided"`). |
| `omitted` (shown as "Not on map") | Things that exist (or, in a plan, will exist) but are deliberately left off the map: tests, docs, low-value context nodes. Leave it empty rather than writing "none". An entry that says what the group is and why (three or more words, then its `folder/` or glob) is also drawn on the page as a dashed `omitted` box in its area. |
| Your prose (not the spec) | Findings, risks and opinions: "migration lacks an index", "no backfill for existing rows". |
