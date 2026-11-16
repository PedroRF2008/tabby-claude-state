#!/usr/bin/env bash
# Installs the tabby-claude-state hook for Claude Code on this Linux/WSL/SSH host.
#   bash scripts/install-hooks.sh            install / update (idempotent)
#   bash scripts/install-hooks.sh --uninstall
# Backs up settings.json first; only touches hook entries that reference
# tabby-claude-state.sh.
#
# The hook script always lives in $HOME/.claude/hooks and is referenced as
# "$HOME/.claude/hooks/…", whatever CLAUDE_CONFIG_DIR says: tools such as CCM
# run Claude with CLAUDE_CONFIG_DIR pointing at a per-login directory whose
# settings.json is a link to the real one, so the command must resolve the same
# under every identity. CLAUDE_CONFIG_DIR only decides which settings.json to
# edit, and a linked settings.json is edited at its real location.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_DIR="$HOME/.claude/hooks"
HOOK_DST="$HOOK_DIR/tabby-claude-state.sh"
SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
if [ -L "$SETTINGS" ]; then
  real="$(readlink -f "$SETTINGS")"
  echo "settings.json is a link -> $real"
  SETTINGS="$real"
fi
MODE="${1:-install}"

command -v python3 >/dev/null || { echo "python3 is required to edit settings.json safely" >&2; exit 1; }

mkdir -p "$HOOK_DIR" "$(dirname "$SETTINGS")"
if [ "$MODE" != "--uninstall" ]; then
  # Copy with LF line endings even if the repo was checked out with CRLF.
  tr -d '\r' <"$SRC_DIR/hooks/tabby-claude-state.sh" >"$HOOK_DST"
  chmod +x "$HOOK_DST"
  echo "hook script -> $HOOK_DST"
fi

[ -f "$SETTINGS" ] || echo '{}' >"$SETTINGS"
backup="$SETTINGS.pre-tabby-claude-state.$(date +%Y%m%d%H%M%S)"
cp "$SETTINGS" "$backup"
echo "backup     -> $backup"

python3 - "$SETTINGS" "$MODE" <<'PY'
import json, sys
path, mode = sys.argv[1], sys.argv[2]
with open(path) as f:
    settings = json.load(f)

MARK = "tabby-claude-state.sh"
# Literal $HOME, expanded by the shell at hook time: identical under every
# CLAUDE_CONFIG_DIR (CCM Profiles, per-account config dirs).
CMD = '"$HOME/.claude/hooks/tabby-claude-state.sh" '

# event -> (matcher or None, state argument)
EVENTS = {
    "UserPromptSubmit":   (None, "working"),
    "PreToolUse":         ("*",  "working"),
    "PostToolUse":        ("*",  "working"),
    "PostToolUseFailure": ("*",  "working"),
    "PermissionRequest":  ("*",  "waiting"),
    "Notification":       (None, "notify"),
    "Stop":               (None, "done"),
    "StopFailure":        (None, "error"),
    "SessionEnd":         (None, "idle"),
}

hooks = settings.setdefault("hooks", {})

# Remove our previous entries (idempotent), keep everything else untouched.
for event in list(hooks.keys()):
    groups = []
    for group in hooks[event]:
        kept = [h for h in group.get("hooks", []) if MARK not in h.get("command", "")]
        if kept:
            group["hooks"] = kept
            groups.append(group)
        elif not group.get("hooks"):
            groups.append(group)
    if groups:
        hooks[event] = groups
    else:
        del hooks[event]

if mode != "--uninstall":
    for event, (matcher, arg) in EVENTS.items():
        group = {"hooks": [{"type": "command", "command": CMD + arg, "timeout": 5}]}
        if matcher is not None:
            group = {"matcher": matcher, **group}
        hooks.setdefault(event, []).append(group)

if not hooks:
    del settings["hooks"]

with open(path, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")
print("settings   -> %s (%s)" % (path, "hooks removed" if mode == "--uninstall" else "hooks installed"))
PY

if [ "$MODE" = "--uninstall" ]; then
  rm -f "$HOOK_DST"
  echo "removed $HOOK_DST"
fi
echo "Done. Restart running Claude Code sessions (or run /hooks) to pick up the change."
