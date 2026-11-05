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

Agents load a skill only when they think of it, and in long sessions they sometimes don't. `install-skill` also adds up to three helpers, pre-checked in its question and on without one. `--no-reminder` / `--no-hook` / `--no-plugin` leave one out; `--reminder`, `--hook` or `--plugin` adds only that one. They cost tokens only when they work: the reminder line is about 40 tokens per session, and the hook and plugin cost nothing until they send the agent back for a map.

- **Reminder line**: one line in your agents' global instructions file (`~/.claude/CLAUDE.md`, `~/.config/opencode/AGENTS.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`) asking them to use codechart for changes that touch 3+ files or add branching behaviour. It sits between `<!-- codechart -->` markers; an older line there is replaced.
- **Claude Code hook** (only when Claude Code gets the skill): adds `codechart hook prompt` (UserPromptSubmit) and `codechart hook stop` (Stop) to `~/.claude/settings.json`. When a turn changed 3+ files and the reply has no diagram, Claude is asked once to follow the skill. Files you had already changed before the turn don't count. If `settings.json` isn't valid JSON, codechart leaves it alone: add the two hooks by hand.

- **OpenCode plugin** (only when OpenCode gets the skill; OpenCode 2 only): copies one self-contained file, the plugin, to `~/.config/opencode/plugins/codechart.js` (under `$XDG_CONFIG_HOME` if you set it), a folder OpenCode loads on its own: no `opencode.json` edit, no npm install. After a turn that changed 3+ files, it sends the agent one message asking for a map if the reply has none. Files changed before the turn don't count; failed turns, sub-agent sessions and Claude Code sessions run through OpenCode are skipped (Claude Code's own hook covers those). Like a skill copy, an older copy of ours is refreshed by `install-skill` and `codechart update` (no network needed), and a file of that name that isn't ours is left alone unless you pass `--force`. `install-skill`, `update` and `doctor --fix` only copy when `opencode --version` (PATH, then `~/.opencode/bin`) reports 2 or later; on OpenCode 1, or when it can't be run, they print `OpenCode plugin skipped` and leave it alone, and `doctor` shows a ⚠. `uninstall` deletes our copy only. Restart OpenCode after installing: it loads plugins at startup.

The hook and the plugin keep, per session, the names and content hashes of your changed files in `~/.cache/codechart/turns` (removed after 7 days), never their contents. It also logs there what it decided each turn (and whether the transcript showed the skill loaded), which `codechart doctor --last` reads.

## Common questions

**My agent asks permission for every render, even though I allowed `codechart`.**
The skill pipes the spec in with a heredoc (`codechart render --md - <<'EOF'`). In Claude Code, an allow rule like `Bash(codechart:*)` didn't cover that in our tests, so Claude Code asks before each render: approve it.

**I use VS Code, Cursor, Windsurf or Antigravity, and "Open full map" shows HTML source.**
Those editors open file links as text. codechart detects them and opens new pages in your browser instead. Where the editor doesn't allow that (Antigravity sandboxes agent commands), the reply includes the page's address to paste into your browser. Turn auto-open off with `web.open: never` in `~/.config/codechart/config.yaml` (see [Configuration](configuration.md)).

## No diagram appeared

Run `codechart doctor`. It checks, for each agent it finds, that the skill is installed and current, the reminder line is there and (Claude Code) the hooks are set, (OpenCode) the plugin file is there and current, and that `codechart` is on PATH and not behind the newest version. Each problem ends with the command that fixes it. A ✗ (skill missing or outdated, outdated reminder, CLI off PATH or behind) makes it exit 1; a missing reminder, hook or plugin is only a ⚠, because you may have left it out with `--no-reminder` / `--no-hook` / `--no-plugin`; a plugin pinned to another version is a ✗. `codechart doctor --fix` runs the ✗ fixes and checks again; the ⚠ ones it only names (add them with the command shown). A skill folder that isn't codechart's is only reported, never overwritten. It ends with a short prompt to paste into the agent as a test.

Everything checks out but a turn still got no diagram? Run `codechart doctor --last` in that repo (Claude Code and OpenCode). It reads what the hooks or the plugin logged for the latest turn and says in plain words what the Stop hook (or plugin) decided, which rule would fire on the changed files, where the hook's 3-file threshold and the rules disagree, and whether the skill was loaded (not recorded for a turn that changed no files). No log at all means the hooks never ran (for OpenCode: restart it after installing the plugin): sessions hosted by the Claude Agent SDK sometimes load none ([anthropics/claude-code#87657](https://github.com/anthropics/claude-code/issues/87657)); start a new session after fixing what `doctor` shows.

## Uninstall

```bash
codechart uninstall && npm uninstall -g codechart
```

`codechart uninstall` removes the skill, the reminder lines, the hooks and the OpenCode plugin file (`--skill`, `--reminder`, `--hook`, `--plugin` to pick some). npm can't run it for you: it has no uninstall scripts since v7. Skill folders holding other files keep them. [PR maps](pr-maps.md) live in your repos: delete their CI file there.
