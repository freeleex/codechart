# Explain map spec

For step 8 of [SKILL.md](SKILL.md). A map of how an existing area works, for an engineer new to the project. Nothing changed, so there is no diff and no change mark. `codechart schema` prints the JSON Schema (`"kind": "explain"`).

## When

The user asks to understand code that already exists: "explain how billing works", "map of the billing module", "onboard me on X". Not for a change (summary, step 2), not for step-by-step behaviour (a flow, "show me the flow"), not for a product owner (step 6).

## Read first

Read the area before writing: the entry points, the models or tables, the services and jobs they call, what they read and write. Draw only what you read; what you didn't goes in `gaps`.

## Shape

```json
{ "kind": "explain", "title": "How billing works",
  "nodes": [
    { "id": "invoices-api", "label": "POST /invoices", "kind": "endpoint", "status": "existing", "layer": "api",
      "path": "app/api/invoices.py", "match": "def create_invoice(",
      "summary": "Creates an invoice for a customer and starts the charge." },
    { "id": "billing", "label": "BillingService", "kind": "service", "status": "existing", "layer": "billing",
      "path": "app/billing/service.py", "match": "class BillingService",
      "summary": "Totals the lines, applies discounts and calls the payment provider.",
      "notes": ["A zero total skips the charge but still sends the receipt."] },
    { "id": "invoice", "label": "invoices", "kind": "table", "status": "existing", "layer": "database",
      "path": "app/models/invoice.py", "fieldsComplete": false,
      "fields": [{ "name": "status", "type": "enum draft|paid|void" }] },
    { "id": "email", "label": "EmailService", "kind": "service", "status": "outside", "layer": "other areas", "path": "app/email/service.py" },
    { "id": "stripe", "label": "Stripe API", "kind": "other", "status": "outside", "layer": "other areas" }],
  "edges": [
    { "from": "invoices-api", "to": "billing", "label": "create_invoice", "kind": "calls" },
    { "from": "billing", "to": "invoice", "label": "status", "kind": "writes" },
    { "from": "billing", "to": "email", "label": "receipt", "kind": "calls" },
    { "from": "billing", "to": "stripe", "label": "charge", "kind": "calls" }],
  "flows": [
    { "id": "create", "title": "Create an invoice", "start": "receive",
      "steps": [
        { "id": "receive", "label": "receive the request", "status": "existing", "box": "invoices-api",
          "source": "app/api/invoices.py", "match": "def create_invoice(" },
        { "id": "free", "label": "total is zero?", "status": "existing", "box": "billing",
          "source": "app/billing/service.py", "match": "if total == 0" },
        { "id": "skip", "label": "skip the charge", "status": "existing", "box": "billing",
          "source": "app/billing/service.py", "match": "return skip_charge" },
        { "id": "charge", "label": "charge the card", "status": "existing", "box": "billing",
          "source": "app/billing/service.py", "match": "provider.charge" }],
      "links": [
        { "from": "receive", "to": "free" },
        { "from": "free", "to": "skip", "label": "yes", "source": "app/billing/service.py", "match": "if total == 0" },
        { "from": "free", "to": "charge", "label": "no", "source": "app/billing/service.py", "match": "provider.charge" }] }],
  "gaps": ["refund job: not read"] }
```

- One box per table, model, service, endpoint, job or file, labelled as the code names it. About 15 at most: a bigger area is split by feature, one map each.
- `existing`: part of the area. `path` is required, and a `match` (a distinctive piece of one line, on exactly one line of the file) is the proof, so give one where you can; the render checks both.
- `outside`: a neighbour the area talks to but that isn't in it: another module's service, a shared table, an external API. Give `path` when it is in the repo (checked like the others); an external service has none.
- `summary`: one line on what the box is for. `notes`: what surprises a newcomer: hidden rules, odd cases, things that look wrong but are on purpose. Leave both out when there is nothing to say.
- `layer` required, from a small set (`api`, `billing`, `database`, `other areas`). `fields`: no `change`; `fieldsComplete` as in [spec-guide.md](spec-guide.md).
- Edges: dependent → dependency, in plain words (the column, method or key), never pasted code; only ones you saw. No `change`.
- Not allowed: `new`, `changed`, `removed`, `config` and `context` boxes, edge or field `change`, `was`, `drift`, `omitted`. No `rules`: nothing triggers an explain map but the user's ask.
- `gaps`: what you did not read or run.
- `flows`: the 2-5 main behaviours of the area, each one a step-by-step flow on the page's Flows tab; leave it out when the area has no behaviour worth following. Each is `{ id, title, start, steps, links, gaps? }`: `id` unique, `title` a plain-words name of the behaviour ("Create an invoice"), the rest as in [flow-guide.md](flow-guide.md): steps, decisions with labelled `yes`/`no` branches, every step and every branch out of a decision anchored (`source` as `path:line` or the path plus `match`). At most about 15 steps each; more means two flows. Nothing changed, so every step is `existing` (no other status, no `planned` or `removed` link). Set `box` on a step to the id of the box it happens in, the box whose file holds the step's anchor, so the page links each step to its box and each box to its flows; leave it out for a step that is in no box. A flow's `gaps` are what you did not check in it.
- A step or branch whose anchor doesn't resolve is marked `✗` like a box (not a failed render): reread the file and fix it.

## Render

`codechart render --md - <<'EOF'` as in step 2 of [SKILL.md](SKILL.md), with no diff flags (they and `--pr` are refused). `--at '<rev>'` only when the user asks about another revision. Reply as in step 3: one line on the area, the render output verbatim (with flows it ends with `Flows on the page: …`), then the prose: what surprised you, what you did not read. Never commit the map; draw a fresh one for each request.

For a product owner, QA or support, write the plain-words page from this map next: [business-guide.md](business-guide.md#explain-how-something-works).
