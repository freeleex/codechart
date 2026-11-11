# Business map spec

For step 6 of [SKILL.md](SKILL.md). A product owner reads the page with no repo access, so every sentence is plain words. `codechart schema --business` prints the JSON Schema.

## Shape

```json
{ "diagram": "business", "title": "New refund rules",
  "summary": "Monthly plans now have 14 days to get a refund instead of 30. Large partial refunds wait for a manager.",
  "journeys": [
    { "id": "J1", "name": "Support agent gives back part of a payment", "who": "Support agent",
      "now": [{ "text": "Customer asks for money back" }, { "text": "Agent passes it to a manager", "change": "removed" }],
      "after": [
        { "text": "Customer asks for money back" },
        { "text": "Agent enters the amount and a reason", "change": "new" },
        { "text": "Above €100: the manager gets an approval email", "change": "new" }],
      "links": ["refund-requests", "approvals", "email"], "evidence": "checked" }],
  "rules": [
    { "id": "R1", "name": "Refund window", "before": "A customer could get a refund up to 30 days after paying.",
      "after": "A customer can get a refund up to 14 days after paying.",
      "exceptions": ["Annual plans keep 30 days."],
      "links": ["refund-policy", "subscription-model"], "evidence": "checked" }],
  "data": [
    { "id": "D1", "name": "Refund reason", "what": "Why each refund was given and who approved it",
      "why": "So finance can review refunds later", "links": ["refunds"], "evidence": "checked" }],
  "questions": [
    { "id": "Q1", "about": "R1", "text": "What happens when an agent has no manager?", "kind": "unhandled" }] }
```

- At least one journey, rule or saved data item. Ids unique across all four lists. `map` (optional): file name slug of the tech map to link to.
- `links`: ids of boxes on the tech map (nodes, or steps of a flow); 1 to 12 per item, required. They show where the claim comes from, nothing else.
- Journey steps: `now` and `after`, up to 10 each; `change` `new`/`changed` in `after`, `removed` in `now`; unmarked = same as now.
- A question's `about` is a journey, rule or saved data id.

## Writing

- Plain words for someone who never saw the code. No code, file names or paths, URLs, secrets, setting names, function or table names, backticks, ids copied from the tech map: the render refuses them (a quoted phrase like "Refund now" is fine). Say "the nightly run", not `refund_job`.
- Journeys: what a person sees or does, one step per line, today vs after. Skip a journey nobody can see.
- Rules: the number and the exception, before → after ("14 days after paying", not "shorter window"). `before` is left out for a new rule.
- Saved data: what the business keeps and why, not columns or tables.
- Questions: at most 7, most impactful first, never trivial. `kind`: `unhandled` (a state nothing covers), `number` (a magic number nobody confirmed), `conflict` (two rules disagree), `assumption` (you guessed). Put in only what the owner can answer.

## Evidence

- `checked`: you read the linked code and it does what the sentence says.
- `reading`: you worked it out from names and structure. The page asks the owner to confirm it with Yes or No.
- Never `checked` for something you didn't read. When unsure, `reading`.

## Spot-check (mandatory before rendering)

For each `checked` item, re-read the code behind its links and confirm each sentence, number and exception. Wrong: fix the sentence, or downgrade to `reading`. Links prove where to look, not that the words are right: an earlier trial found a `checked` refund window counted from subscription start instead of payment.

## Tiny changes

1–2 files and nothing a user can see: say a business map adds little and offer a short one. Never invent journeys.

## Explain how something works

How an area works today, for a product owner, QA or support: no change. `codechart schema --business --explain` prints its schema. Draw the explain map of the area first (step 8; [explain-guide.md](explain-guide.md)): links point to its boxes, or to a flow step as `flow:<flow>/<step>`. The page picks `--tech '<explain spec.json>'`, else the spec's `map` slug, else the newest explain map; saved maps are looked up on the current git branch only, so for one drawn on another branch pass `--tech`. A change map is refused, and an explain map is refused for a change page.

```json
{ "diagram": "business", "kind": "explain", "title": "How refunds work",
  "summary": "A support agent can give a customer money back within 14 days of paying.",
  "journeys": [
    { "id": "J1", "name": "Support agent refunds a payment", "who": "Support agent",
      "steps": [{ "text": "Customer asks for money back" }, { "text": "Agent enters the amount and a reason" },
        { "text": "The manager gets an approval email", "if": "the amount is above €100" }],
      "links": ["refunds-api", "flow:refund/approve"], "evidence": "checked" }],
  "rules": [{ "id": "R1", "name": "Refund window", "rule": "Up to 14 days after paying.",
    "exceptions": ["Annual plans keep 30 days."], "links": ["refund-policy"], "evidence": "checked" }],
  "cases": [{ "id": "C1", "situation": "A customer asks twice for the same payment", "outcome": "The second request is refused.",
    "links": ["refunds-api"], "evidence": "reading" }],
  "data": [{ "id": "D1", "name": "Refund reason", "what": "Why each refund was given", "why": "So finance can review it",
    "links": ["refunds"], "evidence": "checked" }],
  "questions": [{ "id": "Q1", "about": "C1", "text": "Should a second request be refused or queued?", "kind": "unhandled" }] }
```

- One feature per page: a bigger area is split, one explain map and page each.
- A journey has one list of `steps`; a step that only happens in some case gets `if` (shown "If X → Y"). Rules have `rule` and `exceptions`, no `before`/`after`. Odd cases: `situation` and `outcome`. A question's `about` may be a case. Up to 8 cases.
- Never "new", "now", "after", "changed" or any before/after wording: nothing changed.
- Stricter evidence: `checked` only for what you read in the code; a guess, an inference from names or something you could not run is `reading`.
- Spot-check is mandatory, as above, for every `checked` item.
- What the code does not cover (a state nothing handles, a number nobody explained, two rules that disagree) goes in `questions`, never filled in with a guess.
- The page is read-only: no notes, Yes/No, answers or send-back, and no review file, so no feedback comes back. Open questions are for the reader to take up with the team; tell the user so.

## Feedback from the owner

Pasted answers come back through step 5 of SKILL.md. Each note names its item and its tech links. Answer: apply it to code or plan. Rejected (a "No"): the reading was wrong; fix the code, plan or your understanding. Confirmed: nothing to do. Never argue in the spec; if the map changes, render a new one. Import says the saved record is gone (over 30 days): tell the user to render the business map again and send the owner the new page.
