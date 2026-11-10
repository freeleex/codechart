# Explain map

A map of how an existing part of the code works, for someone new to the project: what is in it, what each piece is for, and what it talks to. Nothing changed, so there is no diff and no change marks.

## When to use it

When you need to understand code that is already there: onboarding on a module, picking up a feature someone else wrote, or checking what an area touches before you change it. It is for one area at a time. For what the code does step by step, ask for a [flow](flows.md); for a change, the normal map.

## How to ask

```text
> explain how billing works
> map of the billing module
> onboard me on the checkout code
```

The agent reads the area, draws the map and replies with it, followed by what surprised it and what it did not read. It never draws one on its own, and each request gets a fresh map.

<img src="images/explain-map.png" alt="An explain map of refunds and invoices: boxes for the refund endpoint, flags, orders, invoices and payment methods in the area, and dashed faded boxes for the customer model and PayPal it talks to" width="720">

## What you see

- **One box per piece:** a table, model, service, endpoint, job or file in the area, with a one-line summary of what it is for. About 15 boxes; a bigger area is split by feature, one map each.
- **Arrows:** who uses whom, labelled with the column, method or key.
- **Outside boxes:** a part the area talks to but that isn't in it: another module's service, a shared table, an external API such as Stripe. They are dashed and faded, marked `○` in the terminal. Click the *Outside* chip to fade them.
- **Notes:** what would surprise a newcomer: hidden rules, odd cases, things that look wrong but are on purpose.
- **Gaps:** what the agent did not read.

Click a box for its file, the line the agent quoted, its fields, notes and relations. The terminal block says `4 boxes · 2 outside · ✓ 3 checked` and a key, `○ outside · unmarked = in this area`.

## What is checked

Every box in the area must name a file that exists, and the line the agent quotes must be on exactly one line of it. An outside box is checked too when it names a file; an external service has none. A box that doesn't match is marked `✗`. Nothing is compared with a diff, so there is no *not on map* check and no *diff not checked* note. See [Why you can trust the diagram](trust.md#explain-maps).

## Limits

- It shows the code as it is in your working tree. `codechart render --at <rev>` reads the files at another revision; the diff flags (`--git`, `--since`, `--commit`, `--head`) and `--pr` are refused.
- A box proves the file and the quoted line exist, not that its summary is right.
- It is not saved as a plan and never compared with one. It is not for PR descriptions or commits.
- Page notes work as on other maps ([Review](review.md)), but there is no diff, so a note never goes stale and `codechart review` shows the boxes without code changes.

## Related

- [Flows](flows.md)
- [CLI commands](cli.md#explain-maps)
