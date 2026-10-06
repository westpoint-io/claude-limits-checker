#!/usr/bin/env bash
# Installs the limits plugin for Claude Code, plus the status line if you don't have one yet.
# Usage: curl -fsSL https://raw.githubusercontent.com/westpoint-io/claude-limits-checker/main/install.sh | bash
set -euo pipefail

REPO="westpoint-io/claude-limits-checker"
MARKETPLACE="claude-limits-checker"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SETTINGS="$CLAUDE_DIR/settings.json"
STATUSLINE="$CLAUDE_DIR/limits-statusline.sh"

say() { printf '\033[38;2;137;180;250m▸\033[0m %s\n' "$1"; }

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code isn't installed. Get it from https://claude.com/claude-code first." >&2
  exit 1
fi

say "Adding the $MARKETPLACE marketplace"
claude plugin marketplace add "$REPO" >/dev/null 2>&1 || claude plugin marketplace update "$MARKETPLACE" >/dev/null

say "Installing the limits plugin"
claude plugin install "limits@$MARKETPLACE"

if ! command -v jq >/dev/null 2>&1; then
  say "Skipping the status line: it needs jq (brew install jq), then run this again"
elif [ -f "$SETTINGS" ] && jq -e '.statusLine' "$SETTINGS" >/dev/null 2>&1; then
  say "Keeping your existing status line"
else
  say "Installing the status line"
  mkdir -p "$CLAUDE_DIR"
  curl -fsSL "https://raw.githubusercontent.com/$REPO/main/statusline.sh" -o "$STATUSLINE"
  chmod +x "$STATUSLINE"
  [ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
  tmp="$(mktemp)"
  jq --arg cmd "bash $STATUSLINE" '.statusLine = {type: "command", command: $cmd}' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
fi

say "Done. Restart Claude Code, then run /limits"
