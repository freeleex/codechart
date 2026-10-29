# codechart — Design

Status: draft · 2026-10-27

## 1. Why

When a coding agent (Claude Code, Codex, Gemini CLI…) gives a plan or a final summary for a large change, it lists names: tables, columns, models, enums, files, components, config keys. The reader doesn't have the codebase in their head, so those names mean nothing until they open the code and trace the relations by hand. That is slow, and it hides the real shape of the change.

Example of the problem (abridged):

> Migration 0042 adds the invoices table; adds coupon_code on orders; adds refunded to the order_status enum and bank_transfer to payment_method; backfills one invoice per paid order, numbered from INVOICE_PREFIX… Models: Invoice, OrderStatus.REFUNDED, PaymentMethod.BANK_TRANSFER. POST /orders/{id}/refund sets the new status… feature flag refundsEnabled…

**codechart** lets the agent show those names *in context*: what each thing is, what changed, and how it connects, as a diagram, before the user reads the reply.

## 2. What it is

Two pieces:

1. **`codechart` CLI** (npm package, TypeScript). It takes a graph spec (JSON) written by the agent, validates it, and renders it:
   - **terminal view**: a compact ASCII/Unicode map the agent pastes into its reply;
   - **web view**: a self-contained HTML file with the full interactive graph, linked from the terminal view.
2. **Agent instructions**: an Agent Skill (`SKILL.md`) any compatible agent loads telling the agent *when* to make a map and *how* to write the spec.

The agent decides what goes in the diagram. The CLI owns layout and drawing. The agent never draws boxes or arrows itself, because LLMs misalign hand-drawn ASCII.

## 3. Goals

- Show plans **and** post-implementation summaries as a map of the affected things and their relations.
- Cover any related things: DB tables, columns, enums, ORM models, services, API endpoints, frontend components, config/env vars, CI values.
- For each node, show **what it is** (a one-line summary), **its key fields**, and **its status**:
  - `new`: added by this change;
  - `changed`: modified, with the added or removed fields marked;
  - `context`: untouched, shown so the reader knows what it is (e.g. tables A and B when new table C points at them);
  - `config`: a config value or environment variable.
- **Hybrid output (chosen):**
  - Terminal: a short map of only new and changed nodes plus the edges between them. No summaries. A count line, a gaps line, and a link.
  - Web: everything, including context nodes, summaries, full field lists and file paths, grouped by layer, with zoom and click-for-details.
- Configurable per user and per repo: when to draw, which output, and how much context to gather.
- Works with any CLI agent. The CLI is agent-agnostic; only the instruction file is per-agent.
- One install: `npm i -g codechart` (or `npx codechart`). No other tools for the user to install.

## 4. Non-goals (v1)

- No static code analysis. codechart does not parse the codebase; the agent builds the spec from what it read.
- No server, no hosted service, no accounts. The HTML is a local file.
- Not a general-purpose diagram editor or a Mermaid/D2 replacement.
- No history or diffing between maps of different plans.
- No editing the diagram from the browser.

## 5. Anti-goals (would be a failure even if it "works")

- **A diagram as noisy as the list.** A 40-node hairball is no better than 40 names. The terminal view caps at about 15 nodes; past that it collapses to the most relevant ones and defers to the web view.
- **Invented details.** Columns or summaries the agent didn't actually read must never appear as fact. Unknowns go in `gaps` and are shown as such.
- **Slowing every reply.** If no rule matches, nothing happens. Short mode adds no extra file reads.
- **Breaking the agent's flow.** Validation errors must be precise enough for the agent to fix them in one retry.

## 6. When a map is made: rules

Maps are made only when at least one rule matches. Two rule types, both supported:

- **Path rules (default, deterministic):** glob patterns matched against the changed or planned file paths. Example: `migrations/**`.
- **Plain-language rules:** a sentence the agent judges. Example: "a frontend data model changed", "more than 2 related files changed".

Each rule can set its own `output` and `context`, overriding the defaults. A rule also sets `diagram: map | flow` (default `map`); flow rules have no `context` (see flow-design.md §8).

### Config files

- Global: `~/.config/codechart/config.yaml` (respects `XDG_CONFIG_HOME`).
- Per repo: `.codechart.yaml` at the repo root. It overrides global defaults; its rules are placed **before** the global rules.

```yaml
defaults:
  output: auto        # auto | cli | web | both | none
  context: short      # short | full
  flows: auto         # auto | always | request: bar of the built-in behaviour-flow rule
  terminalMaxNodes: 15

web:
  outDir: ~/.cache/codechart   # global config only; one subfolder per repo
  theme: auto         # auto | light | dark
  minNodes: 8         # auto: write HTML from this many nodes on (also when the map cuts text)
  keep: 20            # global config only; cleanup: always keep the newest N files per repo
  maxAgeDays: 7       # global config only; cleanup: also keep anything younger than this

rules:
  - name: typeorm-entities          # more specific first
    paths: ["src/entities/**"]
    output: none
  - name: db-schema
    paths: ["migrations/**", "**/alembic/versions/*.py", "**/models/**"]
    output: both
    context: full
  - name: frontend-models
    when: "a frontend data model, store, or shared API type changed"
    output: cli
  - name: related-files
    when: "more than 2 changed files depend on each other"
```

### Matching semantics

- Each diagram type (`map`, `flow`) is resolved separately. Within a type, rules are evaluated top-down, and for each file **the first matching path rule wins**. That is how "TypeORM model → no diagram" overrides the broader "DB model → diagram".
- Plain-language rules apply to the change as a whole. The agent decides yes or no.
- Final output is the union of the matched rules' outputs: `cli` plus `web` gives `both`. A `none` rule only excludes the files it matched, and only for its own diagram type. It does not cancel other rules.
- `auto` means "terminal map always, HTML only when needed" (see §9). In the union it counts as `cli` plus a conditional `web`: `auto` + `cli` → `auto`; `auto` + `web` or `both` → `both`.
- Final context mode: `full` if any matched rule says `full`, otherwise the default.
- If nothing matches, or every match resolves to `none`, no map is made.

### Built-in rules

codechart ships a built-in rule set so it works with no config file. It covers common migration and model paths across ORMs and frameworks: Alembic, Django, Prisma, TypeORM, Sequelize, Rails, Laravel, Drizzle, and `**/migrations/**`. It also includes two plain-language rules: `related-files` ("more than 2 changed files depend on each other") and `behaviour-flow` (`diagram: flow`, `output: auto`), whose `when` text `defaults.flows` sets: `auto` needs at least 2 decisions or edge cases, `always` any decision, `request` removes the rule.

- Built-in rules sit **after** global and repo rules.
- `useBuiltinRules: false` in either config file turns them off; `defaults.flows` then has no effect and `codechart config` shows it as "inactive (built-in rules off)".
- `codechart init` writes a commented starter `.codechart.yaml` into the repo.

### Making the config easy to understand

- **Defaults are the useful choice.** With no config file, codechart works: built-in rules on, `output: auto`, `context: short`, 15 terminal nodes, `theme: auto`.
- **The starter file lists every option.** `codechart init` writes each option with its default and a one-line explanation, all commented out except one example rule. A user reads it top to bottom and uncomments what they need.
- **Editor help.** The starter file's first line is `# yaml-language-server: $schema=<url of config.schema.json>`, so editors such as VS Code autocomplete and validate every option. The schema is generated from the zod config schema and shipped in the npm package. `codechart schema --config` prints it.
- **`codechart config`** prints the config in effect, saying where each value came from (built-in, global or repo file), and every rule in evaluation order with its source. This answers "why didn't my rule fire?"

### Mechanics: two-step `check`

Rule resolution stays in the CLI, so the agent never merges rule outputs by hand.

1. **`codechart check --files a,b,c`**, or a git selection: `--git` (staged + unstaged + untracked changes vs HEAD), `--commit <sha>` (one commit; a merge against its first parent), `--since <base>` (files committed since `base`, i.e. `git diff base...HEAD`; with `--git` the uncommitted ones too; `--head <ref>` compares `base...ref` for a branch that isn't checked out, so it doesn't combine with `--git`). For plans, where nothing has changed yet, the agent passes the planned paths. An empty `--files` list is a usage error. It prints JSON with (empty fields left out):
   - The git flags replace the `$(git diff … | paste -sd, -)` pipelines the skill used to build, so the agent no longer quotes revisions into a shell substitution (2026-10-28, cost round). codechart runs git itself: an argument array (never a shell), `--no-optional-locks`, `-c core.fsmonitor=false`, `-c protocol.allow=never`, `GIT_NO_LAZY_FETCH=1`, the clean/process commands (and `required`) of repo-local filter drivers blanked, an absolute git path on Windows (S-22 to S-24), a 30 s timeout, `--` after revisions so a file named like a range is never read as a path. Revision arguments are rejected (exit 2) when empty, over 200 characters, starting with `-`, or containing whitespace, control or invisible characters. An unknown revision exits 2 with git's first error line.
   - `pathMatches`: the rule, its `diagram`, its files and its `output` (plus `context` for map rules);
   - `excludedFiles`: `{ map, flow }`, files claimed by a `none` rule of that type;
   - `remainingFiles`: `{ map, flow }`, everything else, per type. Printed only with `excludedFiles`; otherwise it is the input list;
   - `toJudge`: the plain-language rules with their `diagram`, `when` text, and the `output` (plus `context` for map rules) they would contribute if judged true. Left out when it is exactly the built-in set as the skill lists it (`related-files` and `behaviour-flow` with no-config `when`, `output` and `context`), since the skill already states those; any difference (a repo rule, a reworded or overridden built-in, `defaults.flows`, `defaults.output` or `defaults.context` changed, built-ins off) keeps it, and so does `unknownMatched`. When left out and there is no `final`, `judgeBuiltins` lists the built-in names instead, so the default output is never `{}`, which agents read as "nothing to draw" (2026-10-28). *design call:* the comparison is against the no-config built-ins, not `builtinRules` for the effective `defaults.flows`, because `flows: always` or `request` changes what the agent must judge while the skill text stays the same.

   The agent judges each `toJudge` rule against `remainingFiles` of its diagram type only, so excluded files never trigger a plain-language rule.
2. **`codechart check … --matched <rule,rule>`** reruns with the plain-language rules the agent judged true. It returns `final: { map: { draw, output, context, rules }, flow: { draw, output, rules } }`, plus everything step 1 prints.

If there are no plain-language rules at all, step 1 already includes the final result and step 2 is skipped.

**One call in the common case.** (The skill now follows the next paragraph instead; this path stays for other agents.) The skill states the built-in plain-language rules (`related-files`, `behaviour-flow`), so the agent reads the change, judges them and runs `check … --matched` straight away. That output lists `toJudge` only when the repo changed the plain-language rules; the agent reruns only when it does, or when `excludedFiles` change its answer. A `--matched` name the config lacks (e.g. `useBuiltinRules: false`) is not an error: it comes back in `unknownMatched`, with `toJudge` and no `final`, so the agent judges and reruns. Each skipped round trip saves a full-context turn (measured ~60k tokens for the two-call pattern).

**Deciding without `final` (2026-10-28, cost round; amends "the agent never merges rule outputs").** Because `pathMatches` and every `toJudge` entry carry `output` and `context` (and a left-out `toJudge` means the skill's built-ins, each with output `auto`, `related-files` with context `short`), an agent can run `check` once without `--matched` (even in the same tool call as its first diff read) and decide itself: draw a diagram when a `pathMatches` entry of that diagram has output other than `none` or a `toJudge` rule it judges true does; the map's context is `full` when any of those drawing map rules says so, else `short`; the spec's `rules` are those names. The CLI still merges the outputs: `render` resolves the output from the spec's `rules` and rejects unknown or wrong-diagram names, so a wrong judgement can't change what is drawn beyond which rules are named. When no plain-language rule is in effect, step 1 already prints `final` and the agent uses it. `--matched` and `final` stay for other agents and the rerun path.

## 7. Context modes

- **short**: the agent uses only what it has already read during the task. Anything it doesn't know (e.g. columns of a context table it never opened) goes into `gaps` and is shown as "not read: users columns".
- **full**: the agent may read the **minimum** extra files needed to fill context nodes: model or entity definitions for referenced tables, or the top of a file to get its purpose. No broad exploration.

## 8. The spec (agent → CLI contract)

JSON, validated with a schema. `codechart schema` prints the JSON Schema so any agent can learn the format.

```jsonc
{
  "title": "Invoices for paid orders",
  "kind": "summary",                 // "plan" | "summary"
  "rules": ["db-schema"],            // rule names from `check`; drives render's output
  "nodes": [
    {
      "id": "tbl.invoices",
      "label": "invoices",
      "kind": "table",               // table | enum | model | service | endpoint | component | file | config | other; defaults to file when path is set
      "status": "new",               // new | changed | removed | context | config
      "layer": "database",           // free text; becomes a group box (database, backend, frontend, config…)
      "summary": "One invoice per paid order",
      "path": "shop/models/invoice.py",
      "fieldsComplete": true,        // required with fields: true = every field listed, false = only what the agent saw
      "fields": [                    // every field the agent read; changes marked
        { "name": "id", "type": "uuid", "note": "PK" },
        { "name": "number", "type": "text", "change": "added" }   // change: added | removed | modified
      ],
      "notes": ["Numbers are INVOICE_PREFIX plus a running counter"]
    }
  ],
  "edges": [
    { "from": "tbl.invoices", "to": "tbl.orders", "label": "order_id", "kind": "fk" }  // fk | calls | imports | reads | writes | renders | configures | other
  ],
  "gaps": ["customers: columns besides id not read"],
  "omitted": ["tests: test_invoice_backfill.py", "docs: CHANGELOG.md, .env.example"]
}
```

Validation errors (unknown edge endpoints, duplicate ids, bad enums) are printed as one line each with a JSON path, and the command exits non-zero.

- A node label with a hash-like token (7+ hex characters mixing digits and letters, like `a91f0c2e7b45` or a short SHA; this catches about 96% of short SHAs, and the rare hex word with a digit such as `cafe123` is rejected too, by choice) fails: `looks like a hash or file name`; the file name belongs in `path`.
- A node label containing ` / ` or ` + ` fails: `one node per entity`; for flow steps the message adds `(one action per step; no '+' or 'and')`.
- A node without `kind` defaults to `file` when it has a `path`, and fails `required unless path is set` without one (2026-10-28, cost round: fewer keys to write, same output).
- A spec with `steps` and no `diagram` is a flow spec (`diagram: "flow"` inferred); without `steps` it stays a map.
- A node with `fields` but no `fieldsComplete` fails: `required when fields are listed (true if you listed every field, false if only what you saw)` (2026-10-28, dogfood round 3: cards showed only the changed field and the reader couldn't tell whether that was the whole table).

## 9. Rendering

`codechart render spec.json [--output auto|cli|web|both] [--theme auto|light|dark] [--open] [--md]`

`render` loads the same config as `check`, which gives it the `web` settings, `terminalMaxNodes` and the rules.

- **Output:** by default it resolves from the spec's `rules` field, the rule names `check` returned. With no `rules` field, it uses `defaults.output`. `--output` overrides both. When the output resolves to `none`, `render` prints nothing on stdout and one line on stderr saying why (`codechart: no map drawn: its rules (gen) resolve to output none`, or `… defaults.output is none`), exit 0, so the agent knows the empty result is deliberate.
- **`--md`:** prints the whole paste-ready reply block, so the agent never rearranges it: `**Map** _(key: + new  - removed  ~ changed  · context  ◆ config)_`, the terminal map in a ```text block without the key and `full map → …` lines, a blank line, then `[Open full map](file:///…)` on its own line when HTML was written. With output `web`, the header, a blank line and the link. Followed by one blank line, so two renders in one Bash call never glue (a trailing blank line is not part of the paste). Never colored. The link uses the percent-encoded file URL, wrapped in `<…>` when it contains parentheses.
- **`auto` (the default):** the terminal map is always printed. The HTML file is written only when the terminal map can't show everything: nodes were hidden ("+N more in web view"), any text was cut with `…` (label, edge label, target, layer header or field name), or the spec has at least `web.minNodes` nodes (default 8). `cli` keeps cutting without a file. Small changes therefore produce no file at all.

### Terminal

- Built from new, changed and removed nodes, plus `config` nodes, plus the edges between them. Context nodes only appear when an edge needs them as an endpoint.
- Labels are prefixed by a status marker, so the map reads without color (2026-10-28: agents paste the map into markdown, where ANSI color never renders): `+new`, `-removed`, `~changed`, `·context`, `◆config`, no space.
  - Link targets carry the same marker (`─maps─▶ +invoices`). Field markers (`+` `-` `~`) in the fields section mean added, removed, modified.
  - ANSI color is added to labels when stdout is a TTY.
  - Width math counts emoji and wide CJK as 2 columns, since labels may contain them.
- **Layout: one grouped link list per layer** (changed after dogfooding, 2026-10-28):
  - Each layer is a header line, with a blank line before every layer but the first, and under it each source node is written once, in spec order, with its outgoing links indented under it.
  - Each link shows its label on the arrow, and the arrows are aligned within a source.
  - Every link appears exactly once, with no legend and no separate "text" section.
  - Earlier, ascii-dag drawings, its "Edge labels:" legend and a "text" section showed the same kind of information in three places, which confused readers. The real diagram is the HTML.

  ```
  database
    +migration: add invoices ─creates─▶ +invoices
                             ─alters──▶ ~orders
    ~orders ─customer_id─▶ ·customers
  ```
- **Fitting the width:** source labels longer than a third of the width, and link labels that would overflow, are cut with `…`; the full text is in the HTML.
  - When stdout is not a terminal (an agent running codechart), the width is `$COLUMNS` if set, otherwise 80, because the reader's pane is usually narrower than 100.
  - The width is never below 20; narrower requests render at 20.
  - Wrapped lines never split a status marker from its label, and color is applied after wrapping, so escapes never count toward the width.
- **Too many nodes:** keep the most relevant nodes, by status tier (new/changed/removed, then config, then context) then degree, up to `terminalMaxNodes`, and list the rest as "+N more in web view".
- **Fields section** when no HTML is written. Removed nodes list no fields.
- **Footer:**
  - `N nodes · X new · Y changed · Z config`, with `· R removed` after changed only when R > 0;
  - a key line: `key: + new  - removed  ~ changed  · context  ◆ config`;
  - a gaps line;
  - a `not on map:` line (the spec field `omitted`);
  - `full map → file://…`

### Web

- One self-contained HTML file: inline CSS, a little inline JS, and an SVG whose layout `elkjs` computes in Node at render time. Works offline and needs no server.
- Layout by ELK's layered algorithm, with one compound node per layer.
- Nodes are cards showing label, status badge, summary and fields, with added fields green, modified amber and removed struck through. A `removed` node has a red border and badge and a struck-through label.
- Edges are labeled.
- Click a node to open a side panel with its path, summary, all its fields and notes. Fields carry change marks: `+` added (green), `-` removed (struck through, muted), `~` modified (amber), unchanged plain. When `fieldsComplete` is false, a note under the fields says: *Only the fields the agent saw are listed. Set `defaults.context: full` in `.codechart.yaml` to let it read the full definition.*
- Pan and zoom. Light and dark themes.
- Theme `auto|light|dark` is set by config `web.theme` and flag `--theme`; the page has a toggle.
- **Page-level information:** gaps and "Not on map" (the spec's `omitted`) are a page-level section in the side panel, shown when no card is selected and reachable from the header button "Not on map / gaps" (hidden when both are empty). They never appear under a card's details (2026-10-28, dogfood round 3: the list under every card read as belonging to that card).
- Saved to `~/.cache/codechart/<repo-name>-<hash>/<YYYYMMDD-HHmmss>-<slug>.html` (configurable via `web.outDir` in the global config only), so repos stay clean. `<hash>` is 8 hex chars of the repo path, so same-named repos never share or prune each other's files.
- **No pile-up of files:**
  - **Re-renders replace.** Writing a file deletes earlier files for the same repo and slug, so iterating on one plan leaves one file.
  - **Cleanup on every render.** After writing, `render` deletes files in that repo's folder that are both outside the newest `web.keep` (20) and older than `web.maxAgeDays` (7). No background job.
  - **Only its own files.** Cleanup deletes only `*.html` files matching codechart's name pattern, never anything else in the folder.

## 10. Agent integration

- **Agent skill** (`skills/codechart/SKILL.md`). It tells the agent to:
  1. before delivering a plan or a change summary, run `codechart check` once (`--files` for plans; `--git`, `--commit`, `--since` for changes), in the same tool call as its first read of the change;
  2. judge the plain-language rules (the built-ins are listed in the skill; `toJudge` shows them when the repo changed them) against `remainingFiles` of their diagram type, and decide draw and context from the per-rule `output`/`context` ("Deciding without `final`", §6);
  3. write the map and/or flow spec(s), naming the drawing rules in `rules`, and pipe each into `codechart render --md -` (a quoted heredoc, no temp file; `--at '<sha>'` when the commit or branch isn't checked out, so flow anchors resolve against it); a `no map/flow drawn` notice on stderr means skip that diagram;
  4. reply with one line saying what the plan or change is, then the `render --md` output verbatim where the "what changed" list would go, then prose (test results, CI status and so on).
- `codechart install-skill` copies the skill into each detected agent's skills folder (`--agent`, `--dir` to choose).

## 11. Decisions

| Decision | Made by |
|---|---|
| Hybrid output: short map in the terminal, full map in a browser HTML file | User |
| Rules decide when to draw; both path rules (default) and plain-language rules | User |
| Per-rule output (`cli`/`web`/`both`/`none`) and specific rules overriding general ones | User |
| Context modes `short` / `full` | User |
| Name: `codechart` (free on npm as of 2026-10-27) | User |
| TypeScript, Node, distributed via npm | User (on recommendation) |
| Agent writes a JSON spec and the CLI does all layout; no hand-drawn ASCII | design call, user agreed |
| ~~Terminal: `beautiful-mermaid`~~ → ~~Terminal: `ascii-dag` unboxed LR (Rust→WASM shipped in the npm package), clusters of ~3 connected nodes, remaining edges as text lines~~ → grouped link list; web: `elkjs` | User |
| Rejected: mermaid-ascii (Go binary), d2, Kroki (separate installs or Docker) | design call |
| Config: YAML, global + per-repo file, repo rules first, first path match wins | design call |
| HTML output in `~/.cache/codechart/`, not in the repo | design call |
| Terminal cap of 15 nodes, then collapse to an edge list | design call |
| Terminal map is one grouped link list per layer (no ascii-dag drawings, no legend, no text section); HTML is the diagram | User (after dogfooding) |
| Reply shows a bold **Map** label, and the `full map` link goes outside the code block as a clickable markdown link | User (after dogfooding) |
| `render --md` prints that whole reply block, because agents didn't follow the layout reliably | User (after dogfooding round 2) |
| Emoji status markers (`defaults.icons`) removed: too cluttered; markers are always `+ - ~ · ◆` | User (after dogfooding round 2) |
| Blank line between layers in the terminal map, so they don't run together | User (after dogfooding round 2) |
| `codechart check` returns JSON; the agent passes planned paths for plans | design call |
| ~~Two-step `check` (`--matched`) so the CLI, not the agent, merges rule outputs~~ Superseded for the skill by "Deciding without `final`" (§6, cost round): one `check`, the agent decides from per-rule fields, `render` enforces | design call; amended by user (2026-10-28) |
| `none` rules also exclude their files from plain-language judging | design call |
| `render` reads config; output comes from the spec's `rules`, with `--output` overriding | design call |
| Built-in rule set on by default; `codechart init` writes a starter config | design call |
| v1 ships `install-skill` with presets for agents that load Agent Skills | design call |
| Default output `auto`: HTML only when the terminal map hides nodes or cuts text, or the spec has ≥ 8 nodes | User (on recommendation) |
| HTML cleanup on every render: keep the newest 20 per repo and anything younger than 7 days; same slug replaces the earlier file | User (on recommendation) |
| Config discoverability: fully commented `init` template, `$schema` line for editors, `codechart config` showing the effective config and value sources | User (on recommendation) |

## 12. Open risks

- **Terminal renderer:** beautiful-mermaid was too tall and boxes-only; ascii-dag was legible only for clusters of ~3 branching nodes. The terminal map is a grouped link list, so no terminal layout engine is shipped.
- **Line wrapping:** an 80–88 col line wraps in narrow panes and breaks the drawing. The link list respects the actual width (min 20): labels are cut with `…` and footer and `also:` lines wrap at item and word boundaries.
- **Licenses (checked):** ascii-dag is no longer shipped. elkjs is EPL-2.0, and shipping it unmodified inside the HTML requires including its license notice.
- **The agent must paste the terminal output verbatim.** It costs some output tokens, and the agent might "tidy" the ASCII. The skill must forbid editing it.
- **Plain-language rule judgment varies between runs.** Accepted; path rules exist for the cases that need to be predictable.

## 13. Left to the builder

Internal module structure, test strategy details, exact CLI flag names beyond those listed, HTML visual styling, and the edge-ranking heuristic for the terminal cap.
