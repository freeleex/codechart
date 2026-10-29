# codechart

Claude Code skill + CLI. After code changes or a plan, the agent draws a **map** (files, tables, models, config and how they relate) or a **flow** (decisions, edge cases, source lines) in the terminal, in chat and as a self-contained HTML page.

| Map | Flow |
|---|---|
| ![Map](docs/images/map.png) | ![Flow](docs/images/flow.png) |

## Install

Node >= 22.12.

```bash
npm i -g codechart && codechart install-skill
```

Installs the skill into `~/.claude/skills/codechart/`. Claude Code then uses it when it summarizes changes, plans, or explains behaviour.

## What the agent pastes

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

**Map** _(key: + new  - removed  ~ changed  · context  ◆ config)_
```text
database
  +memberships ─user_id─▶ ·users
               ─team_id─▶ +teams
  +migration: add teams ─creates─▶ +teams
                        ─creates─▶ +memberships

backend
  +Team ─maps─▶ +teams
  +GET /users/{id}/teams ─query─▶ +model Team

fields:
+teams        id uuid PK · name text unique
+memberships  user_id uuid FK users · team_id uuid FK teams

6 nodes · 5 new · 0 changed · 0 config
gaps: users: columns not read
not on map: tests: test_teams.py
```

## Commands

| Command | Purpose |
|---|---|
| `codechart check` | Which rules apply to changed files. `--files <csv>`, `--git`, `--commit <sha>`, `--since <base>` (+ `--head <ref>`), `--matched <csv>` |
| `codechart render <spec>` | Render a spec (JSON file or `-` for stdin). `--output auto\|cli\|web\|both`, `--theme auto\|light\|dark`, `--open`, `--md`, `--at <rev>` |
| `codechart schema` | Spec JSON schema; `--flow` for flow specs, `--config` for the config file |
| `codechart config` | Config in effect and where each value comes from (`--json` for machine output) |
| `codechart init` | Write a commented starter `.codechart.yaml` at the git root (`--force` to overwrite) |
| `codechart install-skill` | Install the skill (`--force` to overwrite) |

Spec reference: `codechart schema` (map), `codechart schema --flow` (flow).

## Config

Repo `.codechart.yaml` (`codechart init`) and global `~/.config/codechart/config.yaml`. `codechart config` shows the result. Editor schema: `codechart schema --config` or `config.schema.json`.

| Key | Values | Default |
|---|---|---|
| `defaults.output` | `auto`, `cli`, `web`, `both`, `none` | `auto` (terminal map; HTML only when the map is too big) |
| `defaults.context` | `short` (map what the agent already read), `full` (may read referenced definitions) | `short` |
| `defaults.flows` | `auto` (2+ decisions or edge cases), `always`, `request` | `auto` |
| `defaults.terminalMaxNodes` | number | `15` |
| `web.theme` | `auto`, `light`, `dark` | `auto` |
| `web.minNodes` | HTML from this many nodes on | `8` |
| `useBuiltinRules` | built-in migration/model path rules, `related-files`, `behaviour-flow` | `true` |
| `rules` | your own, run before the built-ins | none |

Global only: `web.outDir` (`~/.cache/codechart`), `web.keep` (`20`), `web.maxAgeDays` (`7`).

Rules: `name` plus exactly one of `paths` (globs: `*`, `**`, `?`, `[..]`; no braces) or `when` (a sentence the agent judges). Optional `output`, `context` (map rules), `diagram: map|flow`. Per diagram type and file, the first matching path rule wins; `output: none` excludes files.

```yaml
rules:
  - name: models
    paths: ["app/models/**"]
    output: both
    context: full
  - name: frontend-models
    when: "a frontend data model, store, or shared API type changed"
  - name: api-flows
    diagram: flow
    paths: ["app/api/**"]
```

## Lightweight

Measured 2026-10-29, codechart 0.1.0, Node 25.3.0, macOS arm64. Details: [docs/efficiency.md](docs/efficiency.md).

- Tarball 46.5 kB packed, 11 files. Installed runtime deps 15.18 MB, 5 packages (commander, elkjs, picomatch, yaml, zod).
- Cold start (median of 10): `--version` 148 ms; `check --files` 151 ms; `render --output web` 316 ms (small map), 524 ms (large), 316 ms (flow).
- Tokens (Sonnet, median of 3, incl. cache reads):

| Scenario | Without | With codechart |
|---|---|---|
| Flow on request | 86k, $0.056 | 152k, $0.098 |
| Change summary | 46k, $0.014 | 127k, $0.106 |

- In a long real session a diagram is about 2 to 3 extra API calls: roughly 2 to 3% of usage per diagram (5 to 7% with a plan and a summary), nothing for trivial changes. Estimate, not a measurement; shorter sessions pay more.

## Safe to run

Audited before release: untrusted input, output injection, file system, subprocesses, denial of service, supply chain, privacy, skill surface. Three independent reviewers; each finding reproduced. Details: [docs/security-review.md](docs/security-review.md), [SECURITY.md](SECURITY.md).

- No network calls at runtime. No telemetry.
- No shell: only read-only `git` commands and the OS opener, via argument arrays.
- Generated HTML loads nothing external; all spec text is escaped.
- Terminal and Markdown output carry no control or escape bytes.
- Flow anchors confined to the repo root (no `..`, absolute paths, escaping symlinks, `.git`).
- HTML saved under `~/.cache/codechart`, not in your repo; the newest 20 per repo plus anything under 7 days old are kept.
- 5 runtime deps, no transitive deps, no install scripts; releases after v0.1.0 carry npm provenance; v0.1.0 is published manually with 2FA.

## License

MIT. Depends on elkjs (EPL-2.0): see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
