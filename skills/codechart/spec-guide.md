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
- Leave out tests, docs and lock files; list them in `omitted` instead (`"tests: test_teams.py"`).
- Don't add a node you can't describe from what you read. Put it in `gaps`.
- In a plan, name files the repo's way (look at neighbouring files for naming and numbering); they are shown as `new`.
- Aim for under 15 nodes. More than that: drop the least connected `context` nodes and mention them in `omitted`.

## Node fields

```json
{ "id": "users", "label": "users", "kind": "table", "status": "changed", "layer": "database",
  "summary": "application users", "path": "app/models/user.py",
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
- `summary`: one short line, what it is (not what changed).
- `fields`: for tables, models and enums: **every** field you read, not only the changed ones. Mark changes with `change` (added, removed, modified); leave unchanged fields unmarked. In `short` mode only fields you actually read; in a plan, the fields you are committing to build are always listed (they are the plan).
- `fieldsComplete`: required on every node with `fields`.
  - `true`: you read the whole definition (model, table or enum) and listed every field.
  - `false`: you list only what you saw, such as the changed columns in a migration. The map then says only some fields are shown.
  - In `full` context, open the definition so you can list every field and set `true`.

## Edges

```json
{ "from": "users", "to": "teams", "label": "team_id", "kind": "fk" }
```

- Direction: from the thing that depends to the thing it depends on (FK holder → referenced table; caller → callee; reader → config).
- `label`: the column, method or key that makes the link (`team_id`, `list_projects()`, `reads DEFAULT_CURRENCY`). Short.
- `kind`: fk, calls, imports, reads, writes, renders, configures, other. Use `writes` for a migration that creates or alters a table, and `other` for a model's `maps` edge to its table.
- Only edges you saw in code, or (in a plan) ones you are committing to build.

## gaps vs omitted vs your prose

| Goes in | What |
|---|---|
| `gaps` | What you did **not** read or do not know: `"users: relations to other tables not read"`, `"migration: downgrade not checked"`. A partial field list is not a gap: set `fieldsComplete: false` instead. Only real unknowns: if you read everything relevant, leave it empty. Never list something you did read: if you saw the migration has no downgrade, that is a finding for your prose, not `"downgrade not checked"`. In a plan, also open decisions that change the map (`"teams: extra columns not decided"`). |
| `omitted` (shown as "Not on map") | Things that exist (or, in a plan, will exist) but are deliberately left off the map: tests, docs, low-value context nodes. Leave it empty rather than writing "none". |
| Your prose (not the spec) | Findings, risks and opinions: "migration lacks an index", "no backfill for existing rows". |
