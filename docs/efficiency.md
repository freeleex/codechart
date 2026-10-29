# Efficiency

Footprint of codechart: download size, startup, tokens. Re-measure with `npm run measure -- --write` (builds, packs, installs the tarball in a temp project; leaves nothing behind).

Commit refs in this doc are from pre-release history and do not resolve in this repo.

## Baseline (2026-10-28)

Before the final round, codechart 0.1.0:

- Tarball: 25.6 kB packed, 76 kB unpacked, 7 files.
- Runtime deps installed: ~17 MB (zod 8.1 MB, elkjs 7.7 MB, yaml 1.2 MB, commander 240 kB, picomatch 116 kB).
- Skill text: ~15 kB.

These figures were taken from disk blocks (`du`) before the later size work and are stale. The measured start of the final round (byte sums) is in "Summary for the README".

## Current

<!-- measure:start -->
Measured 2026-10-29 | codechart 0.1.0 | node v25.3.0 | darwin arm64 | `npx tsx scripts/measure.ts --write`

Size (`npm pack` + `npm i` of the tarball)

| Metric | Value |
|---|---|
| Tarball packed | 46.5 kB |
| Tarball unpacked | 145.9 kB |
| Tarball files | 11 |
| Installed node_modules (runtime, excl. codechart) | 15.18 MB |
| - commander | 207.4 kB |
| - elkjs | 8046.2 kB |
| - picomatch | 93.8 kB |
| - yaml | 686.3 kB |
| - zod | 6148.9 kB |
| Skill text (skills/codechart/*.md) | 26.3 kB |

Cold start (median of 10, `node dist/cli.js`)

| Command | Time |
|---|---|
| `--version` | 148 ms |
| `check --files` | 151 ms |
| `render --output web` small map | 316 ms |
| `render --output web` large map (120 nodes) | 524 ms |
| `render --output web` flow | 316 ms |

HTML output size

| Spec | Size |
|---|---|
| small map | 10.8 kB |
| large map (120 nodes) | 105.8 kB |
| flow | 15.9 kB |

<!-- measure:end -->

## Dead code

knip 5.88.1 and depcheck 1.4.7: no unused files or deps (no WASM/ascii-dag leftovers in code, config or CI).

- Deleted `spikes/` (untracked, gitignored, 212 MB local scratch); dropped its `.gitignore` and eslint ignore entries.
- Un-exported 9 values and 15 types used only inside their own file; removed the unused `EdgeKind` type.
- Tarball unchanged (39.8 kB packed, 9 files): the bundle already tree-shook them.

## Install footprint

Installed size unchanged (15.18 MB; no bundling, deps stay normal dependencies).

Changed: elkjs loaded via dynamic `import()` inside the two `layout()` functions, so only HTML rendering pays for it.

| Command | Before | After |
|---|---|---|
| `--version` | 212 ms | 145 ms |
| `check --files` | 215 ms | 151 ms |
| `render --output web` (small / large / flow) | 317 / 518 / 312 ms | 313 / 526 / 311 ms |

Render is unchanged: it still loads elkjs.

Import cost over bare `node` (70 ms), median of 11: elkjs 73 ms, zod 28, yaml 20, commander 20, picomatch 10.

Dropped:
- `zod/mini`: `import('zod')` 98 ms vs `import('zod/mini')` 97 ms, no startup gain (and same package, so no size gain). Not converted.
- Lazy yaml/zod/picomatch/per-command imports: `check` needs them all; only `--version`/`--help` would gain (at most ~40 ms) and it needs async config loading plus stub commands. Not worth it.

## Token cost

Same task, same fixture, headless agent, with and without the codechart skill. N=3 per scenario per arm (24 runs). Measured 2026-10-28.

Method:
- Pinned commits (e01760f, 24871a8, 81ef463) are from pre-release history, so the bench can't be re-run from the public repo as-is. Command: `npm run build && npm run bench:tokens` (`scripts/token-bench.ts`; re-aggregate stored runs with `-- --aggregate-only`). Raw stream-json per run goes to `--out` (default `.superpowers/sdd/bench/<arm>/`, gitignored; the script refuses a non-empty dir without `--force`).
- Measured under the pre-release name planmap (shim, skill `planmap-bench:planmap`, PATH filter on `planmap`; shown below as codechart). codechart 0.1.0 at 81ef463 (CLI = this branch's `dist/cli.js`), Claude Code 2.1.304, `--model sonnet` (claude-sonnet-5-5), `--max-budget-usd 2`, never more than 3 `claude -p` at once.
- Fixtures: git worktrees at e01760f in the OS temp dir. `scn-trivial` adds one uncommitted edit to `src/commands/schema.ts`. Removed after the run.
- Per run: `claude -p "<prompt> Answer the user as you normally would, using any skills and tools available to you." --output-format stream-json --verbose --setting-sources project --strict-mcp-config --permission-mode dontAsk --allowedTools Bash,Read,Grep,Glob,Skill --disallowedTools Edit,Write,NotebookEdit --no-session-persistence`. Edit tools are denied, so fixtures stay unmodified.
- Isolation: `--setting-sources project` drops the user's `~/.claude` skills, CLAUDE.md, plugins and hooks (nothing there is touched), and Claude Code env vars are stripped. Arms differ only by: with = `--plugin-dir` holding this branch's `skills/codechart` and a `codechart` shim (node dist/cli.js) first on PATH; without = no plugin and a `codechart` shim that exits 127 first on PATH. The init event lists skill `codechart-bench:codechart` only in the with arm, and every other skill, tool and plugin is identical. The skill was invoked in 12/12 with-arm runs and in 0/12 without-arm runs; `codechart` ran only with the skill.
- The `codechart` PATH filter drops every PATH dir that holds a `codechart` file (here `/opt/homebrew/bin`, which also holds node and git) in both arms, so tool availability differs slightly from a normal install, symmetrically.
- Tokens = input + cache read + cache creation + output from the final `usage`; "Turns" is the result event's `num_turns`, which counts user turns too (API calls are 1 to 3 fewer). Cache reads re-count the whole context on every turn, so total grows with turns; the cost column weights cache reads cheaply and is the better "what it costs" figure, but it is noisy with prompt-cache warmth (same task, 4 trivial with-arm runs ranged $0.011 to $0.035).
- Prompts are in `scripts/token-bench.ts` (scenarios 1 flow on request, 2 change summary of 24871a8, 3 `--dry-run` plan, 4 trivial change).

| Scenario | Arm | Total tokens, median (min–max) | Output tok | Turns | Tool calls | Wall s | Cost $ | Delta tokens |
|---|---|---|---|---|---|---|---|---|
| 1 flow | without | 85,378 (84,689–113,464) | 2,608 | 5 | 4 | 22.8 | 0.055 | |
| 1 flow | with | 158,095 (156,444–197,702) | 3,983 | 9 | 7 | 37.1 | 0.118 | +85% |
| 2 summary | without | 45,677 (45,654–45,834) | 940 | 2 | 1 | 12.3 | 0.043 | |
| 2 summary | with | 213,855 (211,182–237,082) | 3,985 | 10 | 8 | 34.9 | 0.140 | +368% |
| 3 plan | without | 67,019 (64,968–89,783) | 2,268 | 5 | 4 | 20.3 | 0.056 | |
| 3 plan | with | 194,218 (188,560–226,359) | 4,102 | 10 | 8 | 35.6 | 0.126 | +190% |
| 4 trivial | without | 38,244 (38,223–38,256) | 208 | 2 | 1 | 7.5 | 0.007 | |
| 4 trivial | with | 63,431 (41,638–63,444) | 260 | 4 | 2 | 8.9 | 0.021 | +66% |

Median split per cell (input / cache read / cache creation): 1 flow 8 / 77.6k / 5.2k without, 12 / 143.5k / 12.8k with; 2 summary 4 / 37.7k / 7.1k, 14 / 189.8k / 20.1k; 3 plan 6 / 58.3k / 6.6k, 14 / 174.5k / 16.2k; 4 trivial 4 / 37.7k / 0.4k, 6 / 60.0k / 3.2k.

Pass criteria (every branch anchored or planned, no invented branches, output pasted verbatim, trivial change gets no diagram), with-arm:

| Scenario | Result | Notes |
|---|---|---|
| 1 flow | pass 3/3 | flow rendered and pasted verbatim every run; one run retried after a render lint error; branches read against the source, none invented |
| 2 summary | pass 3/3 | map + flow pasted verbatim; one run retried after a render lint error |
| 3 plan | partial 1/3 | planned branches marked `?`, but 2 runs altered the pasted block (re-wrapped a `gaps` line; unescaped the header) |
| 4 trivial | pass 3/3 | skill loaded every run (the skill's own skip rule applies only after loading it), no diagram |

Without the skill every run answered the task correctly in prose with no diagram (the criteria only apply to codechart).

Where the delta goes (approximate). Each cell is the full input-side context (system prompt, history, the new tool result) re-read by the turns that follow that tool, median per run. It is not the tool's own text: every cell includes the ~19k baseline context, and the columns sum to the arm's total, not to the delta. The delta per scenario is the with-minus-without total in the table above (+72.7k, +168.2k, +127.2k, +25.2k); the with arm gets there by adding turns that each re-read the baseline plus everything loaded so far.

| Scenario (with arm) | Turns after skill load | Turns after `check` | Turns after guide reads | Turns after `render` | Other turns | Without arm, other turns |
|---|---|---|---|---|---|---|
| 1 flow | 21.8k | 0 | 12.5k | 32.4k | 70.2k | 63.9k |
| 2 summary | 21.9k | 58.4k | 23.0k | 39.2k | 48.3k | 25.9k |
| 3 plan | 21.9k | 61.2k | 0 | 34.9k | 51.4k | 46.0k |
| 4 trivial | 21.8k | 0 | 0 | 0 | 22.3k | 19.2k |

- Rough size of the added text (chars/4): the skill load itself is ~2.0k tokens; the 21.8k above is that plus the baseline re-read.
- Both arms start at about 19k (system prompt and tools); the with arm adds about 260 tokens there (skill description in the listing).
- Most of the delta is turns, not text: with-arm runs take 2 to 5 more turns, and each turn re-reads a 20 to 36k context. Added text itself is small (chars/4, approximate): SKILL.md 8.0 kB (about 2.0k tokens), spec-guide 5.8 kB, flow-guide 7.0 kB (read in 4 of 12 runs, example.md never), `check` output 1.6 to 11 kB per run (about 0.4 to 2.8k tokens), render spec written by the model 1.8 to 7.8 kB (counted in output tokens), render output 0.7 to 2.6 kB.
- `check` ran twice (plain, then `--matched`) in all 6 runs of scenarios 2 and 3 and added 58 to 61k input-side tokens.
- Retries after render errors: 2 of 12 runs (1 extra turn plus a rewritten spec each).
- Map or flow pasted into the reply: final replies are 2.7 to 4.1 kB with vs 2.1 to 2.5 kB (summary), 3.8 to 4.2 kB (plan) and 4.9 to 5.8 kB (flow, prose only) without; output tokens +1.4k to +3.0k.

Top 3 levers for the final round, ranked by estimated tokens saved (per run, with arm). Savings are projections from the table above, not measured interventions; the final round re-measured:
1. Make `check` one call: skip the judge round trip when nothing but the built-in `behaviour-flow` needs judging, or let `check` accept the answer up front, and shrink its output (no file lists echoed back). Saves up to one turn plus about 25k input-side tokens in scenarios 2 and 3 (`check` turns total 58 to 61k).
2. Stop reading guides separately: fold the few rules the model needs into SKILL.md, or make `schema` errors carry the guidance. Guides cost 12.5k (flow) and 23k (summary) input-side tokens when read.
3. Shrink and gate SKILL.md: it is loaded even for a one-line change (+25k, +66% in scenario 4) and re-read on every later turn. A shorter SKILL.md and a skip rule visible in the skill description would avoid the load.

## Benchmark harness

`scripts/token-bench.ts` changes for the final measurement:

- **Warm-up.** Before the measured runs, one run per arm × scenario goes to `<out>/<arm>/warmup/` and is left out of every table. Without it, run 1 of each cell paid the prompt-cache write that runs 2-3 read (about +$0.016 per cold run, enough to flip N=3 medians). `--no-warmup` skips it. Cost: one extra run per cell.
- **Auto-grading** (new table, counts per cell):
  - *paste verbatim*: the last `render --md` output per spec title (from the `"title"` in the render command), taken from the tool result, must appear byte for byte in the final reply (header with key, block, link). Counted over runs that rendered something.
  - *no stray `**Map**`/`**Flow**` line*: a reply line starting with that label (optionally a heading) that is not a pasted header and not a prose sentence (60+ chars after the label) is the header-duplication failure.
  - *trivial skip* (scenario 4): no `render` attempted and no `**Map**`/`**Flow**` in the reply.
  - *first render ok*: the first `render` call had no error.
  - *check + git diff/show in one call*: P3 compliance (a `git` call inside `$(…)` does not count).
  - API calls (distinct assistant messages; `turns` also counts user turns) and line lookups (`sed -n`, `cat -n`, `grep -n`, `nl` calls), medians.
- The grader understands only the current header format (`**Map** _(key: …)_`). Validated on the stored final runs with `--aggregate-only`: the second run gives paste 3/3, 2/3, 3/3 (flow, summary, plan), bare headers in 1 summary run, trivial skip 3/3, first render ok 9/9. This matches the hand grading in the cost review, including the edited `gaps` line and the bare headers in summary-2.

## Token trims

What changed (after the first levers; reasoning in the cost review):

- `check` is one call: terse JSON (empty fields and unexcluded file lists omitted), `toJudge` omitted when it equals the built-ins, `judgeBuiltins` printed instead of `{}`; git flags (`--commit`, `--since`, `--head`) so no separate diff call.
- Content anchors: `match` on a node/step finds the line by text (unique, ambiguity is an error), replacing `path:line` lookups. `render --at <rev>` anchors against a non-HEAD commit.
- Spec defaults: type, diagram and map kind inferred where safe.
- Slimmer skill: SKILL.md body 10.6k to 7.1k chars (6.4k before the quality fix), guides folded in (read in 0/21 with-arm runs, was 4/12), trivial-change skip in the description; constant `**Flow**` header with the title inside the fence.
- Quality fix: restored the verbatim-paste rule, the edge-kind enums and the check-output reading hint after the first final run showed regressions.
- Harness: warm-up run per cell (excluded from tables) and auto-grading (see Benchmark harness).

Method as in "Token cost" (Sonnet, N=3, median, Claude Code 2.1.304) except warm-up runs. Without arm and trivial with arm: `bench-final` (babd441). With arm: `bench-final2` (5120e99, after the quality fix; flow, summary, plan only). Trivial with arm comes from `bench-final` because the skill is not loaded on that path (0/3 loads) and the fix did not touch it. first-round columns are the table in "Token cost", cold prompt cache.

| Scenario | Without: tokens / $ / turns | With, first: tokens / $ / turns | With, final: tokens / $ / turns | Final vs without |
|---|---|---|---|---|
| 1 flow | 86,008 / 0.056 / 6 | 158,095 / 0.118 / 9 | 152,443 / 0.098 / 9 | +77% tokens |
| 2 summary | 45,619 / 0.014 / 2 | 213,855 / 0.140 / 10 | 127,405 / 0.106 / 6 | +179% tokens |
| 3 plan | 68,436 / 0.061 / 6 | 194,218 / 0.126 / 10 | 161,140 / 0.117 / 10 | +135% tokens |
| 4 trivial | 38,243 / 0.006 / 2 | 63,431 / 0.021 / 4 | 38,837 / 0.007 / 2 | +2% tokens |

Quality, with arm, counts out of 3 (auto-graded). "first run" is `bench-final` before the fix; "final" is `bench-final2`. Trivial skip is 3/3 in both arms of `bench-final` (no render, no diagram).

| Check | Flow: first run / final | Summary: first run / final | Plan: first run / final |
|---|---|---|---|
| diagram shown | 3 / 3 | 3 / 3 | 2 / 3 |
| paste verbatim | 3 / 3 | 1 / 3 | 2 of 2 rendered / 3 |
| no unrendered diagram | 3 / 3 | 1 / 3 | 3 / 3 |
| first render ok | 2 / 3 | 1 / 3 | 2 of 2 rendered / 3 |

Notes:
- The without arm got cheaper with warm-up: summary $0.043 (first run) to $0.014, because first-run medians included cold prompt-cache writes. Deltas against the first without column are therefore not comparable; the table above compares like with like (warm both arms for without, warm for with). The with arm in the first round was also cold, so part of its improvement is warm-up, not trims.
- Intermediate quality regression: the first final run (`bench-final`, with arm) had a summary reply containing an edited key line and a split map header, a plan run that drew no diagram, and first-render errors from edge kinds (the enum lists had been trimmed from the skill). Root causes (task the quality fix): lost paste rule, `{}` check output misread, dropped enums. Fixed in f4dbef6/066abe6/5120e99; `bench-final2` is 3/3 on every check. The `bench-final` with-arm token numbers are not used above for those three scenarios.
- N=3: medians move by tens of thousands of tokens run to run (summary with arm: 124k to 129k final, 130k to 164k first run; plan max 221k). Differences under about 20% are not distinguishable. Single-call `check` for summary and plan: 3/3 in summary, n/a in plan (there is no diff to read).
- Still more expensive than without in every non-trivial scenario; the gap is turns (skill load, reading anchors, render, longer reply).

## In a real session (estimate)

The benchmark is a one-question session of 2 to 10 turns, so the diagram is most of the work. Real development sessions are much longer, and almost all their tokens are the conversation being re-read every turn. This section combines measured inputs into an estimate; it is not a direct measurement.

Inputs:
- **Real sessions (measured, 2026-10-28):** the maintainer's Claude Code transcripts from the last 30 days, the 52 sessions with at least 20 turns. Median 86 turns, 11.5M total tokens, 97% of them cache reads, and the conversation is about 130k tokens on a typical turn (p25 99k, p75 198k). This is one heavy user's sample (long, agent-heavy sessions); shorter sessions give higher percentages.
- **What a diagram adds (measured, `bench-final2`):** 2 to 3 extra API calls over a prose answer (median calls, with vs without: flow 6 vs 4, summary 5 vs 2, plan 6 vs 3), plus about 10k tokens of new text (skill, `check` and `render` output, spec, pasted block). `turns` is not used here: it also counts user turns, and context is re-read per API call.

Estimate: one diagram in a session like that costs 2 to 3 extra API calls × ~130k ≈ 0.26 to 0.39M tokens.

| Diagrams in a 86-turn, 11.5M-token session | Extra tokens | Extra, price-weighted |
|---|---|---|
| 1 (e.g. a closing summary) | ~2 to 3% | ~2 to 3% |
| 2 (plan + summary) | ~5 to 7% | ~5 to 7% |
| Trivial changes | 0% | 0% |

"Price-weighted" counts cache reads at about 1/10 of fresh input, cache writes at about 1.25× and output at about 5×, the API's price ratios. Both measures land in the same range. How subscription plans meter usage is not public, so treat either as an approximation. Shorter sessions pay a larger share.

## Summary for the README

Measured 2026-10-29, codechart 0.1.0, node v25.3.0, darwin arm64. Start to end of the final round.

| Size | Before | After |
|---|---|---|
| Tarball packed | 39.8 kB | 46.5 kB |
| Tarball unpacked | 123.8 kB | 145.9 kB |
| Tarball files | 9 | 11 |
| Installed runtime deps | 15.18 MB, 5 packages | 15.18 MB, 5 packages (commander, elkjs, picomatch, yaml, zod) |
| Skill text | 24.6 kB | 26.3 kB (SKILL.md body is 7.1k chars; the rest are guides read on demand) |

| Cold start (median of 10) | Before | After |
|---|---|---|
| `--version` | 213 ms | 148 ms |
| `check --files` | 215 ms | 151 ms |
| `render --output web`, small map | 306 ms | 316 ms |
| `render --output web`, large map | 539 ms | 524 ms |
| `render --output web`, flow | 306 ms | 316 ms |

Tokens and cost with vs without codechart (Sonnet, N=3, median, warm-up; tokens include cache reads):

| Scenario | Without | With codechart |
|---|---|---|
| Flow on request | 86k tokens, $0.056 | 152k tokens, $0.098 |
| Change summary | 46k tokens, $0.014 | 127k tokens, $0.106 |
| Plan | 68k tokens, $0.061 | 161k tokens, $0.117 |
| Trivial change | 38k tokens, $0.006 | 39k tokens, $0.007 (skill not loaded) |

Quality (with arm, final run, 3 runs per scenario): diagram shown, pasted verbatim, no unrendered diagram and first render ok are all 3/3 in flow, summary and plan; trivial change gets no diagram 3/3. The first run before the quality fix failed some of these (see Token trims); numbers above are after it. Differences under about 20% are within N=3 noise.

Cost: a diagram answer costs about 66k to 93k more tokens and $0.04 to $0.09 more than a prose answer at Sonnet prices (median of 3 runs); a trivial change costs nothing extra.

In a real session (estimate, see above): a diagram costs about as much as 2 to 3 extra API calls of conversation. In a typical long feature session that is roughly 2 to 3% of usage per diagram (about 5 to 7% with a plan and a summary), and nothing for trivial changes. Shorter sessions pay a larger share.
