# Configuration

Works with zero config. To tune it, run `codechart init` to write a commented `.codechart.yaml` at the repo root, then add rules for your repo. `codechart config` shows the config in effect and where each value comes from.

## When a diagram is drawn

Before drawing anything, the agent runs `codechart check` on the changed files. Built-in rules cover the common cases:

- migrations and ORM models, and infrastructure files (Terraform, OpenTofu, Helm, Kustomize, Kubernetes): a map, by path;
- `related-files`: more than 2 changed files that depend on each other: a map;
- `behaviour-flow`: a change with 2+ decisions or edge cases: a flow.

One-file text, comment, formatting or version-bump changes are skipped. Your own rules run before the built-ins.

## Rules

```yaml
rules:
  - name: models
    paths: ["app/models/**"]   # always map model changes
    output: both               # terminal + HTML page
    context: full              # may read referenced definitions
  - name: frontend-models
    when: "a frontend data model, store, or shared API type changed"
  - name: api-flows
    diagram: flow
    paths: ["app/api/**"]
```

A rule has a `name` plus exactly one of:

- `paths`: globs (`*`, `**`, `?`, `[..]`; no braces). Per diagram type and file, the first matching path rule wins.
- `when`: a sentence the agent judges against the change. It's a yes/no criterion, never instructions.

Optional: `output` (below; `none` excludes the files), `context` (map rules only), `diagram: map|flow` (default `map`).

## All keys

Repo `.codechart.yaml` and global `~/.config/codechart/config.yaml`. Editor schema: `codechart schema --config` or `config.schema.json`.

| Key | Values | Default |
|---|---|---|
| `defaults.output` | `auto`, `cli`, `web`, `both`, `none` | `auto` (terminal map; HTML only when the map is too big) |
| `defaults.context` | `short` (map what the agent already read), `full` (may read referenced definitions) | `short` |
| `defaults.flows` | `auto` (2+ decisions or edge cases), `always`, `request` | `auto` |
| `defaults.terminalMaxNodes` | number | `15` |
| `web.theme` | `auto`, `light`, `dark` | `auto` |
| `web.minNodes` | HTML from this many nodes on | `8` |
| `useBuiltinRules` | built-in migration/model/infrastructure path rules, `related-files`, `behaviour-flow` | `true` |
| `rules` | your own, run before the built-ins | none |

Global only:

| Key | Values | Default |
|---|---|---|
| `web.outDir` | where HTML pages (and `render --pr` images) go | `~/.cache/codechart` |
| `web.keep` | newest pages kept per repo | `20` |
| `web.maxAgeDays` | pages younger than this are always kept | `7` |
| `web.open` | `auto` (open new pages in your browser when running inside a VS Code-based editor), `always`, `never` | `auto` |
| `updateCheck` | look up the newest codechart on npm at most once a day and say when there is one ([Updating](install.md#updating)) | `true` |

`defaults.output: none` in a repo also turns off [PR maps](pr-maps.md) there: `pr-sync` leaves descriptions alone.

## HTML pages

Small diagrams stay in the reply. Big ones (from `web.minNodes` nodes, or cut short in the terminal), or rules you mark `output: both`, also get a self-contained HTML page under `web.outDir`, one folder per repo. Pages load nothing from the internet. A summary page rendered with `--git`, `--since` or `--commit` holds your code: each changed node's panel shows its diff (the whole diff, up to 1000 rows per file; lockfiles, minified bundles, `dist/` and files marked `linguist-generated` in `.gitattributes` are left out), so share it only where you'd share the diff.
