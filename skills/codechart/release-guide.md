# Release map spec

For step 7 of [SKILL.md](SKILL.md). A product owner reviews the page, then exports it as a PDF for sales and stakeholders, so every sentence is plain words. `codechart schema --release` prints the JSON Schema.

## Gather

Run `codechart release-context` (the merged changes since the last `v*` tag; `--since <tag>` to choose). Read the PR text, the tech map and the diff of each change you are unsure about. Group the changes into features a customer would name; one section per feature, up to 12. Leave out chores, dependency bumps, CI and release commits unless a user can see the effect.

## Shape

```json
{ "diagram": "release", "title": "What is new in Shop 2.0", "version": "2.0.0", "date": "2026-11-09", "since": "1.4.0",
  "summary": "Customers get money back faster, and managers approve large refunds.",
  "sections": [
    { "id": "refunds", "title": "Faster refunds", "change": "new", "pr": 41,
      "summary": "Support agents give back part of a payment without asking a manager first.",
      "journeys": [
        { "id": "J1", "name": "Support agent gives back part of a payment", "who": "Support agent",
          "now": [{ "text": "Agent passes it to a manager", "change": "removed" }],
          "after": [{ "text": "Agent enters the amount and a reason", "change": "new" }], "evidence": "checked" }],
      "rules": [{ "id": "R1", "name": "Manager approval", "after": "A refund above 100 euros waits for the agent's manager.", "evidence": "reading" }],
      "data": [{ "id": "D1", "name": "Refund reason", "what": "Why each refund was given", "why": "So finance can review refunds later", "evidence": "checked" }],
      "questions": [{ "id": "Q1", "about": "R1", "text": "What happens when an agent has no manager?", "kind": "unhandled" }] },
    { "id": "receipts", "title": "Receipts no longer go to spam", "change": "fixed", "summary": "Receipt emails reach the inbox again." }] }
```

- `change`: `new` (did not exist), `changed` (works differently), `fixed` (was wrong, now works). `pr` is optional. `since` is the previous version. `date` is `YYYY-MM-DD`.
- Items are the business map's, without `links`: the release page has no tech map, and no `--tech`. Per section at most 4 journeys, 6 rules, 4 saved data items, 4 questions; a small fix may be just a summary.
- Ids unique across the whole page, section ids included. A question's `about` is an item of its own section.
- Write the items as [business-guide.md](business-guide.md) says: plain words, steps today vs after, the number and the exception, what is kept and why. The render refuses code, file names, paths, URLs, setting names, secrets and ids.

## Evidence

- `checked`: you read the code and it does what the sentence says. `reading`: you worked it out from names, structure or the PR text. When unsure, `reading`. The owner must answer Yes or No on every `reading` before Export is enabled, so a guess shown as `checked` would reach the PDF unconfirmed.

## Spot-check (mandatory before rendering)

For each `checked` item, re-read the code or diff behind it and confirm each sentence, number and exception; fix it or downgrade it to `reading`. Check that each section's `change` matches what the PRs did.

## After rendering

Reply with the printed summary line and link verbatim. Tell the owner to open the page, answer Yes or No on the items marked "Agent's reading", answer the questions, and press **Export release** (then "Save as PDF" in the print window). To send corrections back they press **Send back to developer**; pasted text goes through step 5 of SKILL.md. A "No" removes that item from the PDF: fix the code or the spec and render again if the owner's note says it is wrong.
