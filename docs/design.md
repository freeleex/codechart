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
- No history or diffing between maps of different plans. (One plan map shows its own before and after: see Web, "Now and After".)
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

codechart ships a built-in rule set so it works with no config file. It covers common migration and model paths across ORMs and frameworks: Alembic, Django, Prisma, TypeORM, Sequelize, Rails, Laravel, Drizzle, and `**/migrations/**`. A third path rule, `infrastructure` (2026-11-03), covers Terraform, OpenTofu and Terragrunt (`*.tf`, `*.tofu`, `*.tfvars`, `*.tf.json`, `terragrunt.hcl`), Helm (`Chart.yaml`, `values.yaml`, `values-*.yaml`, YAML and `.tpl` under `charts/` or `helm/`), Kustomize (`kustomization.yaml`) and Kubernetes manifests under `k8s/` or `kubernetes/`. *design call:* a path rule, not a judged one, so an infra change draws a map without the agent deciding, like migrations; the skill's trivial-change skip keeps version bumps quiet. No bare `charts/**` or `templates/**`: UI chart components and non-Helm templates live there. No new node kinds: resources, module calls and Kubernetes objects are `other` (the label already names the type), each pointing at the file that declares it so a summary's diff check holds when only a module's inputs change; a local module's edited code is a `file` node on its folder; variables and values `config`, so an updated skill never writes a kind an older CLI rejects. The node panel title leaves out the kind `other`, and an HTML card title over 22 characters wraps onto a second line after `_ . / -` or a space, since Terraform names run long. It also includes two plain-language rules: `related-files` ("more than 2 changed files depend on each other") and `behaviour-flow` (`diagram: flow`, `output: auto`), whose `when` text `defaults.flows` sets: `auto` needs at least 2 decisions or edge cases, `always` any decision, `request` removes the rule.

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
- **`--md`:** prints the whole paste-ready reply block, so the agent never rearranges it: `**Map** _(key: + new  ~ changed  - removed  ◆ config · unmarked = unchanged)_`, the terminal map in a ```diff block without the key and `full map → …` lines, a blank line, then `[Open full map](file:///…)` on its own line when HTML was written. With output `web`, the header, a blank line and the link. Followed by one blank line, so two renders in one Bash call never glue (a trailing blank line is not part of the paste). Never colored. The link uses the percent-encoded file URL, wrapped in `<…>` when it contains parentheses.
- **`auto` (the default):** the terminal map is always printed. The HTML file is written only when the terminal map can't show everything: nodes were hidden ("+N more in web view"), any text was cut with `…` (label, edge label, target, layer header or field name), or the spec has at least `web.minNodes` nodes (default 8), or it is a plan with Now and After panes (below). `cli` keeps cutting without a file. Small changes therefore produce no file at all.
- **Diff coverage (2026-11-04):** with `--git`/`--since`/`--commit`, a summary map's check also runs diff → nodes: a changed file no node `path` covers (folder paths cover what is under them) and no `omitted` entry names (repo path, file name, `folder/` or glob token in its free text) is a `✗ N changed files not on map` line; `--strict` fails on it. A rename's old path counts as covered when a node points at a file of the same name and the old path is gone. Never flagged: lockfiles and generated files (`GENERATED_PATHS`) and files whose first matching map path rule has output `none`. Plans and flows are not checked this way. *design call:* `omitted` stays free text so existing specs keep working.
- **Plan vs built (P35):** rendering a `kind: plan` map (not with `--pr`, `--at` or `--head`, in a git repo on a branch) saves `{ spec, base: HEAD, savedAt }` to `<web.outDir>/plans/<repo folder>/<branch>/map.json` (mode 0600; a branch name is made one safe path segment, with a hash when it changed). Saving also deletes plan files older than 7 days. A summary map loads the plan saved on its branch if `base` is an ancestor of HEAD, it is at most 7 days old and, with `--git`, `--commit` or `--since`, the summary's range starts at `base` or before (`--commit`: the commit's first parent; `--since`: the merge-base; `--git`: HEAD), and compares. A summary with no diff flag is always compared:
  - nodes match by id, else by the same `path` (and `match` when both have one); `context` nodes on either side are ignored; `config` counts as a change;
  - a planned `new`/`changed`/`removed`/`config` node with no match (or matched to an unchanged one) is **missing** (`− in the plan, not built`); a built one with no match, or matched to a planned `context` node, is **unplanned** (`+ built, not in the plan`); a match whose path, status or changed fields (name, `change`, type) differ, or a planned `"change": "added"` edge between built nodes that is absent (on its `from` node), is **different** (`~ built differently`). Labels, summaries and notes never count;
  - the summary's optional `drift` (`node`, `cause`, `why`: 1-3 plain sentences, max 400 characters; rejected in a plan) explains items by id (a plan id works for a node matched under another id). An item without one is **unexplained**: `✗ … no reason given`, and `--strict` exits 1. A reason for an id that didn't drift is one warning line.
  - Terminal, `--md` and the stdout beside a web link get a `Plan vs built (plan "<title>", drawn <age>)` block above the footer: one item per line, `− audit log  in the plan, not built · why: left for later`, then the agent's `why` on its own wrapped, indented line (cause words: found a bug, plan assumed wrong, you asked for it, found a cleaner way, left for later, other), up to 5 lines, then `N more → full map` (`N more not shown` without a page); no drift is `built as planned ✓ (plan "<title>")`. No saved plan: nothing. Store errors never fail a render.
  - The HTML shows it too: a `◆` on the corner of each drifted node (red when unexplained), the node's panel gets a full-width chip right after the path and summary and before the changes (before fields and notes when there are none): a button tinted by kind (`−` In the plan, not built, `+` Built, not in the plan, `~` Built differently) with one plain sentence (`The plan said to add this service. It wasn't built.`, `It was built in another file than the plan said.`) and a chevron. It is closed at first, except for a ghost (no code to read), and a click on an item in the differences list opens its node with the chip open. Opened, it shows the rows attached under the chip: *Plan* (the old value, struck through) and *Built* (the new value) for a difference, then *Why*: the cause label as a pill (`Left for later`) with the agent's full `why` always shown under it, or a red `⚠ No reason given. Ask the agent why it changed.`; and a **Differences from the plan** list in the page info (it says when the plan was drawn) whose items open their panels, each with its cause label only. The header says `◆ N differences from the plan` (with a red `· M without a reason` when some have none) or `built as planned ✓`; the page never says "drift". A **missing** node with no match in the summary is drawn as a ghost: its plan node added to the layout with the plan's links to nodes on the page, dashed, a readable `NOT BUILT` badge; its edges take part in the layout, and the map draws each edge label where ELK put it (clear of the boxes, ghosts included) instead of at the middle of the line. Ghosts are not counted, checked or reviewed (no tick, panel title `(not built)`), and never trigger the Now/After panes (only plans have them). Without a saved plan the page is unchanged.
  *design call:* a second plan on the same branch replaces the first; the plan lives in the cache, not the repo.
- **`diff not checked` (2026-11-04):** a summary map or flow rendered in a git repo without a diff flag ends its count line (and the HTML check note, and the stdout above a web-only link) with `diff not checked`, so it never looks as verified as one with a diff. Outside a repo it says nothing. *design call:* footer only; defaulting summaries to `--git` would pick the wrong scope for commit or branch summaries.

### Terminal

- Built from new, changed and removed nodes, plus `config` nodes, plus the edges between them. Context nodes only appear when an edge needs them as an endpoint.
- **Marker gutter** (2026-11-05, P29 spike): every node that changed opens a headline with its status marker in the first column, a space, then its kind (unless table, file, other or config) and label: `+ invoices`, `~ enum order_status`, `- coupons`, `◆ INVOICE_PREFIX`. Unchanged nodes carry no marker, as unchanged lines in a diff carry none, and a context node that only receives links is named only where the arrows point. The map reads without color (agents paste it into markdown, where ANSI never renders), and in `--md` the block is a ```diff fence, so every host tested (Claude Code, OpenCode, Codex, Gemini CLI, Cursor, VS Code, GitHub) colors the `+` headlines green and the `-` ones red by itself; `~` and `◆` stay plain. Nothing in the block may start with `+`, `-`, `---`, `+++`, `index` or `diff --git` unless it means that, which is why the footer says `3 more not shown` rather than `+3 more`.
  - Link targets carry no marker (`─maps─▶ invoices`): their own headline shows their status. Field markers (`+` `-` `~`) mean added, removed, modified; a field with `was` reads `~role text → enum`.
  - A plan edge with `change` gets `+` or `-` before its label (`─+reads─▶`).
  - ANSI color is added to headlines and targets when stdout is a TTY.
  - Width math counts emoji and wide CJK as 2 columns, since labels may contain them.
  - *Rejected in the spike:* `<details>` (renders only on GitHub and in OpenChamber; raw text in every TUI), tables (Claude Code transposes a wide one into key/value records at 80 columns), markdown lists (no alignment, no color, agents retype them), box-drawing graphs (three times wider, wrapping destroys them), emoji markers (double-width glyphs misalign the arrows outside true monospace), per-node summaries (+34% tokens; the reply's prose already carries them).
- **Layout: one block per node, grouped by layer** (2026-10-28, reshaped 2026-11-05):
  - Each layer is a header line, with a blank line before every layer but the first, and under it each node is written once, in spec order: its headline, its outgoing links indented under it on aligned arrows, then its changed fields indented four columns.
  - Each link shows its label on the arrow, and the arrows are aligned within a source.
  - Every link appears exactly once, with no legend and no separate "text" or "fields" section. The indented lines are the console's version of an expandable section: scan the gutter, read the details only under the headline you care about.
  - Earlier, ascii-dag drawings, its "Edge labels:" legend and a "text" section showed the same kind of information in three places, which confused readers. The real diagram is the HTML.

  ```
  database
  + migration: add invoices ─creates─▶ invoices
                            ─alters──▶ orders
  ~ orders ─customer_id─▶ customers
      +coupon_code text · ~status order_status
  ```
- **Fitting the width:** names of nodes with links longer than a third of the width, and link labels that would overflow, are cut with `…`; the full text is in the HTML.
  - When stdout is not a terminal (an agent running codechart), the width is `$COLUMNS` if set, otherwise 80, because the reader's pane is usually narrower than 100.
  - The width is never below 20; narrower requests render at 20.
  - Wrapped lines never split a status marker from its label, and color is applied after wrapping, so escapes never count toward the width.
- **Too many nodes:** keep the most relevant nodes, by status tier (new/changed/removed, then config, then context) then degree, up to `terminalMaxNodes`, and list the rest as "N more in web view".
- **Field lines** under each node only when no HTML is written. Removed nodes list no fields.
- **Footer:**
  - `N nodes · X new · Y changed · Z config`, with `· R removed` after changed only when R > 0;
  - a key line: `key: + new  ~ changed  - removed  ◆ config · unmarked = unchanged` (in `--md` it is the header instead);
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
- **Panel header** (P35): every panel opens with a header (title, and on map nodes the agent's `summary` as a muted subheader) separated from the rest by a thin divider; the summary appears nowhere else in the panel (a ghost's is its plan summary); flow steps have no summary.
- **Focus a node's relations** (2026-11-05): the open node, its edges and its neighbours stay lit, everything else dims to 25%; Esc or a click on the empty canvas lights all again. The node's panel lists its links, `→ target (note)` and `← source (note)` where the note is the edge's label, else its kind, nothing for kind `other` without a label, each row a jump to that node that counts as a history visit, the list pinned as a footer at the bottom of the side panel (border above, always visible while the content above scrolls, at the bottom even for short content); an edge's hover title reads `from → to`. In Now/After both panes light the same node.
- **Now and After** (2026-11-03): a plan that touches existing code (a `changed` or `removed` node, an edge with `change`, or a field that is removed, modified or has `was`) is drawn as two panes side by side, Now (the code as it is) and After plan. A plan that only adds things keeps one map, and so does one whose panes would match (only `changed` nodes, or a field `modified` without `was`: 2026-11-03, dogfood). Both come from the one spec:
  - Now leaves out `new` nodes, added edges, edges to new nodes and added fields, and shows a field's `was` type; After leaves out `removed` nodes, removed edges, edges to removed nodes and removed fields.
  - Edges to a new or removed node fall on their side by themselves; `change: added|removed` on an edge (plans only) is for a link that moves between nodes that exist on both sides.
  - ELK lays out every node and edge once, so a node sits at the same place in both panes; the direction is picked for a half-width canvas. Selection is shared; pan and zoom too while the header toggle says "Panes: linked" (default; "separate" moves each pane alone, relinking aligns both to the pane moved last, the choice is remembered). Always-linked panes felt odd in use (2026-11-03). Now tints links that will go red, After tints new ones green.
  - A card's panel lists "Fields now" and "Fields after" when they differ. The side panel starts at half the usual width (min 200px) and saves its own size, so the panes get the room.
  - HTML only: under `auto` such a plan always writes the file; the terminal keeps the combined map.
- Theme `auto|light|dark` is set by config `web.theme` and flag `--theme`; the page has a toggle.
- **Status chips** (2026-11-05): a slim row under the header counts nodes per status present (`+4 new  ~5 changed  −1 removed  ◆2 config  ·3 context`; flows: `planned`, `existing`), which is the colour key a single pane lacked. Click a chip to fade that status to 15% (the chip is struck through, `aria-pressed`); an edge fades when either end does. The first chip, "Δ changes only", when not pressed fades exactly the unchanged nodes (`context`, flows `existing`) and un-fades every other status; it shows pressed while that is the only faded status, and clicking it then clears all fades. The choice is remembered in localStorage (`codechart.faded`) like theme and pane link; statuses the page has no chip for are ignored. Fade, focus dim and a node's own opacity multiply, so none hides another.
- **Reviewed ticks** (2026-11-05): every node, context ones too, has a tickbox on its top-left corner and the panel title has the same tickbox to its left (aria-label "Reviewed"); clicking the canvas box selects and pans nothing. Never ticked by visiting. A ticked node shows a ✓ and a muted border but keeps its opacity, so it stays apart from the chip fade and the focus dim. The same row shows `7/12 reviewed` with a thin progress bar and a "Next ▸" button (Next unreviewed) that selects and pans to the next unticked node (wrapping). Now/After share one tick per node id. Saved in localStorage per repo (`codechart.reviewed:<repo folder>`, the name plus path hash the page's file lives under, so same-named repos stay apart), each toggle rewriting only its own node's entry, as node id plus a hash of the node's diff (the one in its panel); a node without a diff (plan maps, context) is keyed by id alone, so a re-render keeps a tick only where the node's code is unchanged. Flow steps are keyed by id alone.
- **No Light / Full switch** (2026-11-06; 0.6.0 had one, P30-P32): every page is what Full was. The header button, the `data-mode` attribute, the `.fo` / `.lo` classes, the Light cut (3 hunks, 40 rows) and the `codechart.mode` key are gone; the 1000-row per-file cap and the generated-file skip stay. A stale `codechart.mode` in localStorage is simply never read.
- **Panel layout** (2026-11-06): the node path is shown once. A panel with a Changes section names the file in its heading, `CHANGES src/rate-limit.ts … +11 −0` (path in monospace and normal text colour right after the word, wrapping at `/` when long, `+n −m` right-aligned; a capped file shows its changed-line total, with `showing 1000 of N lines` under the hunks) and has no separate path line; a panel without one (a ghost, a context node, no diff given) keeps the path line right under the header. A `match` proof snippet keeps its own path. No "whole file" footer. Relations are two columns, *← Used by* (incoming links) on the left and *Uses →* (outgoing) on the right, `none` when a side is empty, stacking when the panel is under ~300px of content (`auto-fit, minmax(140px, 1fr)`).
- **Selected vs lit node and Focus** (2026-11-06): neighbours of the selected node stay lit as before, but the selected node alone gets a 3px outline (status colour kept, so a new/changed/removed node still reads) and a soft `drop-shadow` glow in `--edge` (45%), which follows any shape and works in both themes. A `◎` Focus button in the panel header (beside the ← → history buttons; disabled when the info panel shows) and the `f` key (same typing/modifier guards as the other keys, in the `?` help) zoom the canvas onto the selected node: the node fills about 35% of the pane, capped at 1.5x, so its neighbours stay in view, centred, with a 250 ms ease-out glide (a wheel or drag cancels it; reduced-motion jumps). Linked Now/After panes follow the first pane that has the node; unlinked panes each glide. The panel title row has `min-height` and an 8px bottom margin so the path line below never touches it.
- **Changes** (P31): every hunk foldable. Rows are frameless and run edge to edge of the panel: a line-number column, a sign column and the code, each added/removed row tinted in full (`--add-bg`/`--rem-bg`, normal text colour, coloured sign, faded number; a light-theme pair), the way GitHub and Linear draw diffs. Each hunk starts with a header row on its own blue-tinted band (`--hh-bg`, borders above and below, a gap between consecutive hunks, so folded headers read as rows and differ from the grey gap rows): chevron, new line number, function context from the `@@` header (in the link colour) and `+n −m` on the right; folded, it also gives the first changed line. Grey gap rows say what is not shown: inside a hunk a run of 4 or more unchanged lines collapses into a `⋯ N unchanged lines` button that opens it in place (state kept when hunks fold or `+ all`/`− all` run; runs of 1-3 stay); between two hunks a plain `⋯ N lines not in the diff` and above the first `⋯ N lines above`, both counted from the hunk headers' new-file line numbers (nothing is embedded, so they don't open; hidden while their hunk is folded). Every hunk starts folded, whatever the node's size (2026-11-06; the earlier rule opened nodes of at most 80 changed lines and 6 hunks); a click on its header, `‹ ›` / `n` `p`, or `+ all` opens it. Per-file cap 1000 rows (`showing 1000 of N lines`), over the 5 MB per-file and 25 MB per-render caps that did not change; the 300-char line clip stays. No whole-file view, no inner scroll box, no pager: the panel scrolls as before. A pager bar for mouse users (hidden for a node with 0 or 1 hunk) heads the section and sticks to the top of the panel: `‹  3 / 10  ›  + all  − all  ? keys`, where ‹ and › are real buttons that do what `p` and `n` do, `+ all` / `− all` open / fold every hunk (explicit, unlike `O` which toggles; the bar wraps in a narrow panel), the counter reads `– / 10` until a hunk is current (then `3 / 10`; screen readers get "hunk 3 of 10") and follows `n`/`p`, clicks on hunk lines and panel changes, and `? keys` toggles the key help. Keys, ignored while typing in a text field or with Ctrl/⌘/Alt held (a focused checkbox doesn't count as typing; Alt+←/→ history, Space and Enter are untouched): `n`/`p` next/previous hunk across the node (opens it and folds every other hunk, blue bar on its left edge, never scrolls the panel; past the last, `end of node · ] next unreviewed`), `]`/`[` next/previous unreviewed node (what "Next ▸" does; the panel restarts at hunk 1), `r` toggles Reviewed (the same state as the box and the tick, no auto-advance), `o`/`O` fold the current hunk / toggle all hunks (clicking a hunk line toggles only that hunk, so any number can stay open), `?` a small key help (Esc closes). Panels are still built lazily from inert `<template>`s on open.
- **Generated files** (P30): lockfiles (`package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `Cargo.lock`, `Gemfile.lock`, `poetry.lock`, `composer.lock`, `go.sum`), `*.min.js`/`*.min.css`, anything under `dist/` and files `.gitattributes` marks `linguist-generated` are never diffed, in either mode: the panel says `generated file, not shown`, and they cost none of the 25 MB budget (measured: a lockfile was most of the cost of full diffs). `-linguist-generated` or `linguist-generated=false` opts a file back in.
- **Page notes** (P33, 2026-11-07): a page paired with a review file (its `#spec-data` carries `change: {slug, branch, at}`, `at` = the file's `renderedAt`) takes notes; one without (`--pr`, `check`) shows no note UI and no `c` in the key help. Targets: a node (💬 in the panel title, or `c` on the selected node), a diff line (hover a row's number, click the `+`; old side on `-` rows, new otherwise, file from the Changes heading), a plan-vs-built box, an arrow (a 💬 button after its label or mid-line, with a wide invisible hit stroke; its notes open in a floating box), a gap or *Not on map* item, and the title. Kind is Comment / Question / Delete, as in the console. Notes are kept in localStorage under `codechart.notes:<repoKey>:<slug>:<renderedAt>`, so a redraw starts a fresh list; on read, malformed entries are dropped, targets checked against their allowlisted shapes, bodies capped at 4000 chars, 500 notes. A node shows a count badge for its notes. **Finish review (N)** (top right, hidden at 0) opens a popup with the message and "Copy and close": numbered plain lines (`On line 13 of src/x.ts (new): Question: …`), then `codechart review · N notes · <token>`, the token being base64url JSON `{v: 1, slug, branch, at, notes: [{t, r?, k}]}` (a business page uses the shorter v2 form, see Import): places and kinds only, so it stays short; the words are the numbered lines above it. Each note and the open box take their kind's colour (comment `--chg`, question `--edge`, delete `--rem`); Save is the one filled button. An arrow's or the title's floating box closes after Save, on a click outside it, a wheel zoom or `f`, unless it holds unsaved text. A message stays under 448 KB (below the importer's 512 KB, tied by a test): with more notes, Finish copies the first part that fits, says "This message has 60 of 140 notes. Paste it, then click Finish review again for the rest.", and the button keeps counting the rest. Page shortcuts do nothing while the popup is open. A copy that worked marks those notes sent (dimmed, still editable; editing makes one unsent); a failed `navigator.clipboard` write selects the text for Cmd/Ctrl+C. The page still makes no network call and the CSP is unchanged: the hand-off is the user's paste, not a request. Note bodies are inserted as text, never markup.
- **Page-level information:** gaps and "Not on map" (the spec's `omitted`) are a page-level section in the side panel, shown when no card is selected and reachable from the header button "Not on map / gaps" (hidden when both are empty). They never appear under a card's details (2026-10-28, dogfood round 3: the list under every card read as belonging to that card).
- Saved to `~/.cache/codechart/<repo-name>-<hash>/<YYYYMMDD-HHmmss>-<slug>.html` (configurable via `web.outDir` in the global config only), so repos stay clean. `<hash>` is 8 hex chars of the repo path, so same-named repos never share or prune each other's files.
- **No pile-up of files:**
  - **Re-renders replace.** Writing a file deletes earlier files for the same repo and slug, so iterating on one plan leaves one file. Pages drawn on another branch stay (see Console review).
  - **Cleanup on every render.** After writing, `render` deletes files in that repo's folder that are both outside the newest `web.keep` (20) and older than `web.maxAgeDays` (7). No background job.
  - **Business records.** A business page's `.review.json` is kept 30 days whatever `web.keep` and `web.maxAgeDays` say, so the owner's late reply still imports; its page follows the rules above. After that, `feedback --import` says the record is gone.
  - **Only its own files.** Cleanup deletes only `*.html` files matching codechart's name pattern, never anything else in the folder.

### Console review

A review is notes from the user to the agent, written in a terminal or on the page (Page notes, above). Three commands (`review`, `comment`, `feedback`) and one file.

- **Review file.** `render` writes `<stamp>-<slug>.review.json` (0600) for every map or flow it draws, in the folder the page would be in: `writeHtml` writes it beside the page, before the prune, and a render that wrote no page (`--output cli`, `--md`, `auto` with a small map) writes it alone (`writeReviewOnly`; `--pr` and `check` write none). A review failure only prints a warning, never fails the render: `{version: 1, change: {slug, title?, kind, branch, html?, renderedAt, range?}, nodes: [{id, label, path?, rev?, lines?, note?}], drift?, edges?, gaps?, omitted?, notes: [{id, node?, target?, rev?, anchor?, kind, body, state, at}]}`. The four optional lists are what the map shows besides nodes, for notes made on them on the page: `drift: [{id, kind, label}]` (plan-vs-built items), `edges: [{from, to, label?}]`, `gaps` and `omitted` as text (flows have no `omitted`); an empty list is left out. A note's `target` is `{type: 'drift', id, kind}`, `{type: 'edge', from, to, label?}`, `{type: 'gap' | 'omitted', text}` or `{type: 'title'}`; a note without one is on a node or line, as before. `node` is now optional: an arrow note keeps its `from` there and a plan-vs-built note its node when that node is drawn; gap, not-on-map and title notes have none. `nodes[].lines` is the diff preview the map showed (what the user read) and `rev` its hash (`diffRev`, the one browser ticks use); `note` carries a preview's "generated file, not shown". A flow's nodes are its steps, with the path of their `source` and, as `rev`, a hash of what the step's panel shows (label, status, type, source, its code, and its outgoing links with theirs), so a changed step turns its notes outdated like a changed diff does. Labels, paths and diff text are stripped of control and invisible characters when the snapshot is built, and `review`, `--print` and `feedback` strip them again from what they print (SECURITY.md: no escape bytes in output).  `html` is the page's path, absent for a review file written alone.
- **Change identity** is repo + branch + slug: the repo is the folder the file lives in, the branch comes from `git symbolic-ref` (`(detached)`, or empty outside git), the slug from the title (the title itself is kept too, for display: a file without one shows the slug). The commands take the newest review file of the current branch, or `--change <title or slug>`, any case. Node ids are agent-authored and not stable across renders, so nothing else keys on them.
- **Carry-over.** Rendering a slug again on the same branch reads the previous review file before pruning replaces it and copies its notes: a note whose node id still exists stays if the node's `rev` is the same, else it becomes `outdated`; if the id is gone, the node with the same `path` gets the same test (and the note moves to its id); no match: `outdated`. A note never moves to another line. A note with a `target` stays while the new render still has it (same drift id and kind, same arrow ends and label, same gap or not-on-map text; the title always), else a pending one turns `outdated`. `sent` notes stay `sent`; `outdated` ones stay outdated. The same slug on another branch starts empty and leaves that branch's page and notes alone: "re-renders replace" applies per branch, read from the review file next to each older page (a page with no review file is replaced as before; age and count pruning still apply to all).
- **Pruning.** A page and its review file are one entry named `<stamp>-<slug>`, replaced, aged and counted together; a review file written alone is an entry too. A review file whose recorded `html` is gone (or that can't be read) is deleted on the next prune; one with no `html` stays. A render that wrote no page replaces older review-only entries of its slug and branch and leaves pages alone (a page may be open); the next render that writes a page replaces those too. Only names of the form `<stamp>-<slug>.review.json` are touched.
- **Stale check.** A map drawn with `--git` stores HEAD and a hash of the uncommitted files' content hashes (`range`); `--since` without `--head` stores HEAD; `--commit` and `--head` store nothing (the first cannot change, the second is not HEAD). `review` recomputes it and warns on a difference. It does not re-read the diffs: that needs the spec, which the page does not keep, and the user is shown what the map showed, so a note's line is a line they saw.
- **Writes.** A review file is written to a temp file beside it (0600) and renamed over it, so a reader never sees half a file. `comment`, `feedback --take` and the final save of `review` are each one read-modify-write under `<review file>.lock`, created exclusively: a second command retries for about 2 seconds, then says another command is saving; a lock older than 10 seconds is a crashed command's and is removed; the lock is always released. The file is read again inside the lock, so a note saved meanwhile is kept. (A render that writes the next review file does not take the lock: it reads the previous file once to carry the notes over.) A review file that cannot be saved never replaces the earlier one: the render prints a warning and leaves the earlier page and review file, and their notes, in place.
- **Import** (`feedback --import`, P33). Page notes reach the file only through the user: the page has no network and cannot write files, so the agent (skill §5) pipes the pasted chat text into `feedback --import --take`, or the user runs `feedback --import` in a terminal, which reads piped stdin or else the clipboard (`pbpaste`; `powershell Get-Clipboard`; `wl-paste`, `xclip`, `xsel`, first that works; `execFileSync`, no shell, 3 s timeout, 1 MB buffer). The text is untrusted: at most 512 KB, the token after the last `codechart review ·` line must be base64url, decode to JSON and pass a strict zod schema (`v: 1`, strings ≤ 2000 chars, ≤ 500 notes, the target shapes the page writes; or a business page's `v: 2`, see below); anything else is "damaged" and nothing is saved. Each note's body is read from the numbered item `i. On <place>: <Kind>: <body>` above that line (text after the first `: <Kind>: `, indented continuation lines joined, ≤ 4000 chars); a missing or out-of-order item, a kind that differs from the token's, a different count or an empty body is "doesn't match its last line" and nothing is saved. The map is found by exact slug and branch from the token, not by title. **Business token (v2, 2026-11-08):** a business page sends `{"v":2,"s":"<slug without .business>","b":"<branch>","n":[["J1","c","a1b2c3"],…]}`: item id, kind code (`c` comment, `a` answer, `y` confirmed, `n` rejected) and the item's 6-character rev (`businessRev`, the first 6 hex of its words' hash), no `at`; strict schema, ≤ 500 notes, rev `^[A-Za-z0-9_-]{6}$`. The importer rebuilds the v1 payload from it. About 200 characters for 5 notes, against ~600 for v1; map and flow pages keep v1. The dialog shows the closing line in full, small and muted, wrapped anywhere, so a manual copy gets all of it. Under the lock, each note is rebuilt from the saved snapshot: a node or line note is `pending` only if the node exists, its `rev` matches the page's and the anchored line is in the stored diff (its quote comes from the snapshot, never the paste); a target note only if the target is still there; else `outdated`. Bodies go through `sanitizeText` and blanks are dropped; a note equal to one already in the file (`sameNote` and the same `rev`, any state) is skipped, so a second paste adds nothing. Ids continue the file's `n<k>` numbering.
- **Notes** are `comment`, `question` or `delete` (no "looks good": a tick already says that). States: `pending` (written, not read by an agent), `sent` (printed by `feedback --take`), `outdated` (carry-over, above). `feedback` prints pending ones only.
- **Document.** `review` writes a heading per node (`## label — path  [id]`: label first, the id last in brackets for the parser and the agent; the older `## [id] label` is still read), nodes with a diff first in map order, then the rest under one `# Unchanged on the map` line, a node on the same file and lines as an earlier one pointing back to it (unless a note is anchored to one of its lines: then its rows print, so the anchor survives a save), labels and paths flattened to one line in headings, and its lines (`<sign><line number>  <code>`, hunk headers as they are; the document and `feedback` speak of the map by its title and nodes by label, ids in brackets) to a private temp file, opens `$VISUAL`, `$EDITOR`, or `vi` (`notepad` on Windows) through `sh -c` (Windows: one cmd.exe line with the quoted temp path), reads it back (any line ending: CRLF and CR are turned into LF first, and a file that differs only in line endings counts as unchanged) and deletes it. If a note line could not be placed under a node, nothing is saved: the exit status is 1 and the file is kept with its path printed, so a parse problem can never lose typed notes. A note's anchor is the nearest diff row above it in the same node, so an edit that moves a note moves its anchor. Notes the file already held and left alone keep their id and time. Saving does not trust the file picked at the start: the editor can stay open while the change is re-rendered or the agent runs `feedback --take`. It finds the change again by slug on the branch it was opened on (not the one checked out now) and merges into that file as it is under the lock: notes that were pending at open are replaced by the edited ones, carried onto the fresh nodes by the carry-over rules; a note sent meanwhile stays sent; a note added meanwhile (`comment`) stays. If the change can no longer be found, or the save fails for any reason, nothing is lost: the exit status is 1 and the temp file is kept, its path printed.

### Business map

A third diagram, `"diagram": "business"`, written only when the user asks (skill §6; no rule or hook triggers it). Spec: title, summary, journeys (Now/After steps), rules (before, after, exceptions), saved data (what, why) and up to 7 questions about one of those; every item has `links` (technical map box ids) and `evidence` (`checked` or `reading`). `render` validates it before drawing:

- **Links.** The boxes come from `--tech <spec.json>`, else the newest saved review file on the branch (or the spec's `map` slug); none is an error. A link to a missing box, or an item without links, is rejected.
- **Plain words.** Every reader-visible string is scanned for code, paths, file names, URLs, setting names, hashes, secrets (shown as their first four characters) and technical ids copied from the map; quoted phrases and everyday slashes (`and/or`, `24/7`) pass.
- **Output.** One self-contained HTML page (the same CSP and page script as the other pages), written like other pages with a review file of kind `business`. No terminal, `--md` or `--pr` map. Answers, yes/no verdicts and notes live in localStorage; *Send back to developer* copies them in the page-notes format, and `feedback --import` accepts the extra note kinds `answer`, `confirm` and `reject`.
- **Not checked.** That the words match the code: links only say where to look. The agent's re-read of `checked` items is a skill rule.

### Release map

A fourth diagram, `"diagram": "release"` (P53), written only when the user asks or `check` says so (skill §7). It is not reviewed: it shows what is already in main, as a PDF for sales and stakeholders. One page for a whole release: `title`, `version`, `date`, `summary`, optional `since`, and 1 to 12 sections `{id, title, change: new|changed|fixed, summary, pr?, journeys?, rules?, data?}`. The items are the business map's, reused from `src/spec/business.ts` with `links` and `evidence` omitted (`.omit`): per section at most 4 journeys, 6 rules and 4 saved data items; a section may hold none (a small fix). A spec with `questions` or `evidence` is refused with a message that says the release map only holds checked facts. Ids are unique across the page, section ids included. Every text goes through the plain-words check.

- **Page.** `src/render/release/`: a static document, print-first, with no client script at all (no `CLIENT_JS`, no `<script>`), so its CSP is `default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'`, with no `script-src` hash. A cover (logo, product, version, date, summary, counts), then the features flowing: a heading stays with its first content, cards are not split, no forced page per feature. One light palette; the screen shows the same sheet as the paper (a grey backdrop and white A4-wide sheet on screen only). `@page` numbers pages bottom-right, none on the cover. No trust tags, legend, bar, dialog or PR numbers.
- **Files.** Slug `v<version>-<title>.release` (`src/render/release/slug.ts`): the version leads so `check` can tell whether a release was drawn. No review file is written, `feedback --import` never involves it, and prune treats the page like any other (the next render of the same slug replaces it; a PDF beside it is left alone).
- **PDF.** `src/commands/release-pdf.ts`. After the page is written, `render` runs an installed Chromium-family browser with `--headless=new --disable-gpu --no-pdf-header-footer --no-first-run --no-default-browser-check --user-data-dir=<fresh temp dir> --print-to-pdf=<temp file> file://<page>` through `execFile` (no shell, 60 s timeout). It prints into the throwaway profile, checks the file starts with `%PDF`, and copies it to `<page name>.pdf` or `--pdf`; the profile is removed afterwards. The browser is `release.browser` (global only: a repo must not choose a program to run) when set, else the first existing of fixed absolute paths (macOS `/Applications`, Linux known names in absolute `PATH` entries, Windows Program Files and `LOCALAPPDATA`), never a bare name looked up in the current folder. No browser or a failure keeps the page, prints one stderr line and exits 0.
- **Release branches.** `release.branches` (globs) and `release.auto` (`suggest`, `draw`, `off`) make `check` add `release: {action, branch, version?, path?}` on a matching branch (not on a detached HEAD). `draw` answers `done` with the path of an existing PDF (or page) for that version.
- **Product and logo.** `release.product` (one line, up to 80 characters) and `release.logo` (repo-relative, `.svg` or `.png`, at most 200 KB). The logo must resolve inside the repo root after `realpath` (no absolute path, `..` or escaping symlink), be a regular file with matching content (PNG signature, or `<svg`), and is embedded as a `data:` URI in an `<img>`, where an SVG runs no script. A logo that fails any check is warned about on stderr and left out.
- **Not built.** No tech links (so no `--tech`), no release-context data in the spec: the agent writes the sections from the changes `codechart release-context` lists.

## 10. Agent integration

- **Agent skill** (`skills/codechart/SKILL.md`). It tells the agent to:
  1. before delivering a plan or a change summary, run `codechart check` once (`--files` for plans; `--git`, `--commit`, `--since` for changes), in the same tool call as its first read of the change;
  2. judge the plain-language rules (the built-ins are listed in the skill; `toJudge` shows them when the repo changed them) against `remainingFiles` of their diagram type, and decide draw and context from the per-rule `output`/`context` ("Deciding without `final`", §6);
  3. write the map and/or flow spec(s), naming the drawing rules in `rules`, and pipe each into `codechart render --md -` (a quoted heredoc, no temp file; `--at '<sha>'` when the commit or branch isn't checked out, so flow anchors resolve against it); a `no map/flow drawn` notice on stderr means skip that diagram;
  4. reply with one line saying what the plan or change is, then the `render --md` output verbatim where the "what changed" list would go, then prose (test results, CI status and so on).
  5. when it writes a PR or MR description and the repo runs `codechart pr-sync` in CI, render the summary map again with `--pr` and paste the printed section at the end of the description; otherwise paste the `--md` map.
- `codechart install-skill` copies the skill into each detected agent's skills folder (`--agent`, `--dir` to choose). `codechart update` installs the newest version with npm and runs it to refresh existing copies and reminder lines. A once-a-day npm check (opt-out, global config only) puts a notice where it costs no tokens: the HTML header and a human's terminal; agent runs get one stderr line a day that the skill passes on.
- **Turning PR maps on** (`codechart setup-pr-maps`): opt-in per repo, never automatic. Like Renovate's onboarding PR, consent is explicit: the command prints the whole CI file and the token it uses, then asks (`--yes` for agents, after showing the user). It writes to the work tree uncommitted, or with `--pr` pushes a `codechart/pr-maps` branch built in a scratch index (work tree untouched) and opens a PR to merge or close. It pins the installed version so upgrades are reviewed. The skill only runs it when the user asks (`skills/codechart/pr-maps.md`); in repos without it, the agent mentions PR maps once per conversation. `install-skill` doesn't offer it: that runs once per machine, outside any repo.
- **PR/MR maps** (`render --pr [--svg <file>]`, `codechart pr-sync`, `templates/github-workflow.yml`, `templates/gitlab-ci.yml`). The description section holds the map as an SVG image (the HTML page's drawing, laid out for an ~880px description), the check result in words, collapsed node details, and the spec in a hidden comment between `<!-- codechart:start/end -->` markers. On every push, CI runs `pr-sync`: it takes the spec from the description, renders it against the PR's diff at its head commit (`--since base --head head --at head`), publishes the image (GitHub: a commit on `refs/codechart/pr-<n>`, linked through `github.com/<o>/<r>/raw/<sha>/map.svg` so readers' own sessions load it in private repos; GitLab: a project upload) and replaces only that section. It skips saving when a newer push arrived or the spec changed meanwhile. SVG over Mermaid: GitHub and GitLab strip HTML and JS from descriptions, and Mermaid could not be styled like the map (GitHub drops `<small>` and ignores `look`/`layout` config).

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
