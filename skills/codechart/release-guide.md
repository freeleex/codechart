# Release map spec

For step 7 of [SKILL.md](SKILL.md). `codechart render` prints the page to a PDF for sales and stakeholders. A quick skim is enough; every sentence points to merged code. It shows what is already in main, so every sentence is a plain-words fact you checked in the code, the PR text or the diff. `codechart schema --release` prints the JSON Schema.

## Gather

Run `codechart release-context` (the merged changes since the last `v*` tag, or every commit in a repo with no tags at all; `--since <tag>` to choose, and when it asks for `--since`, ask the developer which tag or commit was the last release). Read the PR text, the tech map and the diff of each change you are unsure about. Group the changes into features a customer would name; one section per feature, up to 12. Leave out chores, dependency bumps, CI and release commits unless a user can see the effect.

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
          "after": [{ "text": "Agent enters the amount and a reason", "change": "new" }] }],
      "rules": [{ "id": "R1", "name": "Manager approval", "after": "A refund above 100 euros waits for the agent's manager." }],
      "data": [{ "id": "D1", "name": "Refund reason", "what": "Why each refund was given", "why": "So finance can review refunds later" }] },
    { "id": "receipts", "title": "Receipts no longer go to spam", "change": "fixed", "summary": "Receipt emails reach the inbox again." }] }
```

- `change`: `new` (did not exist), `changed` (works differently), `fixed` (was wrong, now works). `pr` is optional and not shown. `since` is the previous version. `date` is `YYYY-MM-DD`.
- Items are the business map's without `links`, `evidence` and `questions`: no tech map, no trust tag, nothing for anyone to answer. A spec with `questions` or `evidence` is refused. Per section at most 4 journeys, 6 rules, 4 saved data items; a small fix may be just a summary.
- Ids unique across the whole page, section ids included.
- Write the items as [business-guide.md](business-guide.md) says: plain words, steps today vs after, the number and the exception, what is kept and why. The render refuses code, file names, paths, URLs, setting names, secrets and ids.

## Only checked facts

For every sentence, number and exception, re-read the code, the PR text or the diff behind it and confirm it. If you can't: ask the developer in chat before rendering, or leave it out. Never guess, and never write "probably" or soften it into something vaguer. Check that each section's `change` matches what the PRs did.

## After rendering

Reply with the PDF path and the page link from the printed output. The PDF needs a Chromium-based browser (Chrome, Chromium, Edge, Brave); without one the render prints a warning and keeps the page, which can be saved as a PDF from any browser's print window. To change the PDF, fix the spec and render again.
