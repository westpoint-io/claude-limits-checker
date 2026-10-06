# claude-limits-checker

Keeps an eye on your Claude Code usage limits, and stops deep research from burning Fable when you can't afford it.

```
🕤 5h 6% 21:20 | 🗓️ 7d 74% Oct 8 18:00
Deep research on Fable asks first right now. You're on Opus.
  ✗ 5h resets in 3h 12m (needs under 30 min)
  ✓ Weekly 74% used (needs under 75%)
```

## Install

Run this in your terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/westpoint-io/claude-limits-checker/main/install.sh | bash
```

Or paste this to Claude Code:

```
Install the Claude Code plugin from https://github.com/westpoint-io/claude-limits-checker by running
curl -fsSL https://raw.githubusercontent.com/westpoint-io/claude-limits-checker/main/install.sh | bash
```

Then restart Claude Code and run `/limits`.

The script installs the `limits` plugin. If you don't have a status line yet, it also sets up the [Catppuccin one](https://github.com/westpoint-io/claude-status-line). If you already have one, it leaves it alone.

<details>
<summary>Install by hand</summary>

```bash
claude plugin marketplace add westpoint-io/claude-limits-checker
claude plugin install limits@claude-limits-checker
```

For the status line, save `statusline.sh` somewhere and point `statusLine` in `~/.claude/settings.json` at it:

```json
{ "statusLine": { "type": "command", "command": "bash ~/.claude/limits-statusline.sh" } }
```

</details>

## What it does

### Your limits

Under the prompt you always see both windows and when they reset. The clock face matches the 5h reset time.

### Deep research guard

Before a deep research prompt runs on Fable, it checks two things:

- your 5h window resets in under 30 minutes (use it or lose it)
- your weekly usage is under 75%

If both are true, the prompt runs on Fable as normal. If not, it stops and asks:

```
This looks like deep research on Fable.
✗ 5h resets in 3h 12m (needs under 30 min)
✓ Weekly 74% used (needs under 75%)
Which model should run it?

  1. Sonnet
  2. Opus
  3. Keep Fable
  4. Cancel
```

Sonnet or Opus switches the model and sends your prompt again. Keep Fable runs it anyway. Cancel drops it.

The same check runs on research commands like the built-in `/deep-research`. Pick Sonnet or Opus there and it switches the model and runs the command again.

Haiku reads each prompt once to tell deep research apart from everything else. Quick questions, edits and fixes go straight through, and so does anything on a model you don't watch.

## Commands

| Command | What it does |
|---|---|
| `/limits` | Prints your limits and today's verdict, and opens the settings pane (it also opens by itself when a session starts) |
| `/limits:settings` | Opens just the settings pane |

## Settings

Open the pane with `/limits` and change things there. It saves straight away.

| Setting | Default | Meaning |
|---|---|---|
| Models to watch | Fable | Fable, Opus or both |
| 5h window resets within | 30 min | Deep research is allowed only this close to the 5h reset |
| Weekly usage under | 75% | Deep research is allowed only while the week is below this |
| Open on start | On | Opens the settings pane with your limits whenever a session starts |

You can also use `/config` under limits, or `claude plugin configure limits@claude-limits-checker`.

## Requirements

- Claude Code 2.1.288 or newer
- A Claude subscription (Pro or Max) for the 5h and weekly numbers. Before the first response of a session there's no reading yet, so it asks to be safe.
- For the status line: `jq`, `git`, and a truecolor terminal. `gh` is optional, for the PR number.

## Development

```bash
claude plugin validate .
claude plugin test .
```

`hooks/rules.ts` has the rule and the status text, `hooks/register.tsx` the prompt check, the dialog, the commands and the settings pane.

## License

MIT, see [LICENSE](LICENSE). Free to use and change, at home or at work.

Made by [Westpoint](https://westpoint.io). The status line comes from our [claude-status-line](https://github.com/westpoint-io/claude-status-line). Found a bug or want something added? [Open an issue](https://github.com/westpoint-io/claude-limits-checker/issues), PRs are welcome too.
