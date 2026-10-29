# codechart walkthrough: change summary after committing

Task: the user asked to let users belong to teams. You added a `teams` table, a `memberships` join table, a `Team` model, and an endpoint that lists a user's teams, and committed it in two commits on top of `9c1e2a0`.

## 1. Check, in the same call as the diff read

```
$ git diff '9c1e2a0..HEAD'; codechart check --since '9c1e2a0'
<the diff>
{
  "pathMatches": [
    { "rule": "migrations", "diagram": "map", "output": "auto", "context": "short",
      "files": ["migrations/versions/7f3d_add_teams.py"] },
    { "rule": "orm-schema", "diagram": "map", "output": "auto", "context": "short",
      "files": ["app/models/team.py"] }
  ],
  "judgeBuiltins": ["related-files", "behaviour-flow"]
}
```

`judgeBuiltins`, not `toJudge`, so the repo uses the built-in rules. From the diff: the endpoint imports the model and the migration creates the model's tables, 3 files that depend on each other, so `related-files` is true. `behaviour-flow` is false: listing a user's teams has no decisions or edge cases worth drawing.

So: a map (all three rules have output `auto`) with context `short` (none says `full`), rules `migrations`, `orm-schema`, `related-files`; no flow.

## 2. Spec (`short`: only what was read in this task)

`users` was not changed, but `memberships` points at it, so it is a `context` node.

```json
{
  "title": "Users can belong to teams",
  "kind": "summary",
  "rules": ["migrations", "orm-schema", "related-files"],
  "nodes": [
    { "id": "teams", "label": "teams", "kind": "table", "status": "new", "layer": "database", "fieldsComplete": true,
      "fields": [{ "name": "id", "type": "uuid PK" }, { "name": "name", "type": "text unique" }] },
    { "id": "memberships", "label": "memberships", "kind": "table", "status": "new", "layer": "database", "fieldsComplete": true,
      "fields": [{ "name": "user_id", "type": "uuid FK users" }, { "name": "team_id", "type": "uuid FK teams" }] },
    { "id": "users", "label": "users", "kind": "table", "status": "context", "layer": "database" },
    { "id": "team-model", "label": "Team", "kind": "model", "status": "new", "layer": "backend", "path": "app/models/team.py" },
    { "id": "list-teams", "label": "GET /users/{id}/teams", "kind": "endpoint", "status": "new", "layer": "backend", "path": "app/api/teams.py" },
    { "id": "migration", "label": "migration: add teams", "status": "new", "layer": "database", "path": "migrations/versions/7f3d_add_teams.py" }
  ],
  "edges": [
    { "from": "memberships", "to": "users", "label": "user_id", "kind": "fk" },
    { "from": "memberships", "to": "teams", "label": "team_id", "kind": "fk" },
    { "from": "team-model", "to": "teams", "label": "maps", "kind": "other" },
    { "from": "list-teams", "to": "team-model", "label": "query", "kind": "reads" },
    { "from": "migration", "to": "teams", "label": "creates", "kind": "writes" },
    { "from": "migration", "to": "memberships", "label": "creates", "kind": "writes" }
  ],
  "gaps": ["users: columns not read"],
  "omitted": ["tests: test_teams.py"]
}
```

```
$ codechart render --md - <<'EOF'
<the spec JSON from step 2>
EOF
```

## 3. The reply

````
Users can now belong to teams (2 commits).

<render --md stdout, pasted verbatim: the `**Map** _(key: …)_` line, the map block, and the full map link if any>

- `memberships` has a unique (user_id, team_id) pair, so a user can't join a team twice.
- Tests: 12 new, all passing.
- Not done: removing a user from a team (no endpoint yet).
````
