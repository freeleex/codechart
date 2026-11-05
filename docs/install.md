# Install and agents

```bash
npm i -g codechart && codechart install-skill
```

Needs Node 22.12+. `install-skill` finds the agents you use and asks which ones get the skill. An older codechart copy is updated; a folder holding something else is skipped (`--force` overwrites it). Skip the question with `--agent codex,gemini`, or use `--dir <skills folder>` for anything else.

Then open your coding agent in any repo and try:

```text
> summarize the uncommitted changes
> plan adding refunds to orders
> show me the flow of accepting an invite
```

## Updating

```bash
codechart update          # installs the newest version and refreshes your skill copies
codechart update --check  # only says whether there is one
```

`update` looks up the newest version on npm, runs `npm install -g codechart@<version>` when npm installed codechart (otherwise it says which command to run, e.g. for pnpm, Bun or Yarn), then lets the new version refresh the skill copies and reminder lines you already have, including copies installed with `install-skill --dir`. It doesn't add any you didn't install. What changed: [releases](https://github.com/freeleex/codechart/releases).

**Knowing when there's one.** At most once a day, after a command finishes, codechart asks npm for the newest version (one request, 1-second limit, nothing sent but the request itself). When there's a newer one you hear it where it costs no tokens: a small note in the header of every HTML page until you update, and one line a day in your terminal when you run codechart yourself. In agent runs it prints one line on stderr at most once a day, and the skill asks the agent to pass it on in one line. It never checks in CI or under `npx`, which runs the newest version anyway. Turn it off with `updateCheck: false` in `~/.config/codechart/config.yaml`, or `CODECHART_NO_UPDATE_CHECK=1` / `NO_UPDATE_NOTIFIER=1`. The last result, and the `--dir` folders `update` refreshes, are kept in `~/.cache/codechart/update-check.json`.

[PR map](pr-maps.md) CI jobs run the version pinned when you set them up: change the version in the CI file to move them on.

## Supported agents

Any agent that supports [Agent Skills](https://agentskills.io): Claude Code, Codex, Gemini CLI, GitHub Copilot, Cursor, OpenCode, Goose, Amp, Windsurf, Cline, Roo Code, Kiro, Junie and Factory Droid.

**Not on the list?** If it loads `SKILL.md` skills, run `codechart install-skill --dir <its skills folder>`. If not, the CLI still works for any agent that can run a command and write JSON: point it at `codechart schema` and `codechart render`.

Already use the [skills CLI](https://skills.sh)? `npx skills add freeleex/codechart` installs the skill, but not the CLI it runs: add `npm i -g codechart` too. Pick one way to install the skill, so your agent doesn't load it twice.

## Help agents remember it

Agents load a skill only when they think of it, and in long sessions they sometimes don't. `install-skill` also adds two helpers, pre-checked in its question and on without one. `--no-reminder` / `--no-hook` leave one out; `--reminder` or `--hook` adds only that one. They cost tokens only when they work: the reminder line is about 40 tokens per session, and the hook costs nothing until it sends Claude back for a map.

- **Reminder line**: one line in your agents' global instructions file (`~/.claude/CLAUDE.md`, `~/.config/opencode/AGENTS.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`) asking them to use codechart for changes that touch 3+ files or add branching behaviour. It sits between `<!-- codechart -->` markers; an older line there is replaced.
- **Claude Code hook** (only when Claude Code gets the skill): adds `codechart hook prompt` (UserPromptSubmit) and `codechart hook stop` (Stop) to `~/.claude/settings.json`. When a turn changed 3+ files and the reply has no diagram, Claude is asked once to follow the skill. Files you had already changed before the turn don't count. If `settings.json` isn't valid JSON, codechart leaves it alone: add the two hooks by hand.

The hook keeps, per session, the names and content hashes of your changed files in `~/.cache/codechart/turns` (removed after 7 days), never their contents. It also logs there what it decided each turn (and whether the transcript showed the skill loaded), which `codechart doctor --last` reads.

## Common questions

**My agent asks permission for every render, even though I allowed `codechart`.**
The skill pipes the spec in with a heredoc (`codechart render --md - <<'EOF'`). In Claude Code, an allow rule like `Bash(codechart:*)` didn't cover that in our tests, so Claude Code asks before each render: approve it.

**I use VS Code, Cursor, Windsurf or Antigravity, and "Open full map" shows HTML source.**
Those editors open file links as text. codechart detects them and opens new pages in your browser instead. Where the editor doesn't allow that (Antigravity sandboxes agent commands), the reply includes the page's address to paste into your browser. Turn auto-open off with `web.open: never` in `~/.config/codechart/config.yaml` (see [Configuration](configuration.md)).

## No diagram appeared

Run `codechart doctor`. It checks, for each agent it finds, that the skill is installed and current, the reminder line is there and (Claude Code) the hooks are set, and that `codechart` is on PATH and not behind the newest version. Each ✗ line ends with the command that fixes it; `codechart doctor --fix` runs them for you and checks again. A skill folder that isn't codechart's is only reported, never overwritten. It ends with a short prompt to paste into the agent as a test.

Everything checks out but a turn still got no diagram? Run `codechart doctor --last` in that repo (Claude Code only for now). It reads what the hooks logged for the latest turn and says in plain words what the Stop hook decided, which rule would fire on the changed files, where the hook's 3-file threshold and the rules disagree, and whether the skill was loaded. No log at all means the hooks never ran: sessions hosted by the Claude Agent SDK sometimes load none ([anthropics/claude-code#87657](https://github.com/anthropics/claude-code/issues/87657)); start a new session after fixing what `doctor` shows.

## Uninstall

```bash
codechart uninstall && npm uninstall -g codechart
```

`codechart uninstall` removes the skill, the reminder lines and the hooks (`--skill`, `--reminder`, `--hook` to pick some). npm can't run it for you: it has no uninstall scripts since v7. Skill folders holding other files keep them. [PR maps](pr-maps.md) live in your repos: delete their CI file there.
