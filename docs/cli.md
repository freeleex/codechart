# CLI commands

The skill calls these; you rarely need to. `codechart <command> --help` lists every option.

| Command | Purpose |
|---|---|
| `codechart check` | Which rules apply to changed files. `--files <csv>`, `--git`, `--commit <sha>`, `--since <base>` (+ `--head <ref>`), `--matched <csv>` |
| `codechart render <spec>` | Render a spec (JSON file or `-` for stdin). `--output auto\|cli\|web\|both`, `--theme auto\|light\|dark`, `--open`, `--md` (paste-ready markdown), `--at <rev>`; `--git`, `--commit <sha>`, `--since <base>` (+ `--head <ref>`) to check claims against the diff; `--strict` to exit 1 on a mismatch; `--pr` prints a map's PR/MR description section and writes its SVG to the cache folder (`--svg <file>` writes it elsewhere, `--image-url <url>` sets where the description loads it) |
| `codechart setup-pr-maps` | Add the CI job for [PR maps](pr-maps.md): shows the change and asks first. `--yes` (no question), `--pr` (open a pull/merge request instead of writing to the work tree), `--host github\|gitlab` |
| `codechart pr-sync` | In CI: redraw the map section of this PR or MR's description against its latest commit (see [PR maps](pr-maps.md)) |
| `codechart schema` | Spec JSON schema; `--flow` for flow specs, `--config` for the config file |
| `codechart config` | Config in effect and where each value comes from (`--json`) |
| `codechart init` | Write a commented starter `.codechart.yaml` at the git root (`--force` to overwrite) |
| `codechart install-skill` | Install the skill for the agents found in your home folder. `--agent <names>`, `--dir <path>`, `--force` to overwrite a folder that isn't an older codechart copy, `--no-reminder`, `--no-hook`, `--no-plugin` (or `--reminder`, `--hook`, `--plugin` for only one). See [Install and agents](install.md) |
| `codechart update` | Install the newest codechart with npm and refresh the skill copies, reminder lines and OpenCode plugin pin you have; `--check` only reports. See [Updating](install.md#updating) |
| `codechart uninstall` | Remove the skill, reminder lines, hooks and OpenCode plugin pin; `--skill`, `--reminder`, `--hook`, `--plugin` to pick some |
| `codechart doctor` | Check that your agents can find codechart: per detected agent the skill (current, outdated, missing, or a folder that isn't codechart's), the reminder line, the Claude Code hook and the OpenCode plugin pin, plus `codechart` on PATH and its version against the newest npm one seen (no network). Problems end with the command that fixes them: ✗ for a skill or CLI that is missing, outdated or not codechart's (exit 1), ⚠ for a missing reminder, hook or plugin, ✗ for a plugin pinned to another version (`--fix` rewrites the pin), which you may have opted out of (exit 0). Agents sharing a skill folder show it once. `--fix` runs the ✗ fixes itself (never over a skill folder that isn't codechart's), only names the opt-in ones, and checks again. `--last` explains why the last turn in this repo did or didn't get a diagram (Claude Code, OpenCode). See [No diagram appeared](install.md#no-diagram-appeared) |
| `codechart hook prompt\|stop` | Run by the Claude Code hook (OpenCode's plugin runs inside OpenCode, not through this command); reads the hook's JSON on stdin and logs its decision for `doctor --last` |
