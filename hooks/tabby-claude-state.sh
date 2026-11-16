#!/usr/bin/env bash
# tabby-claude-state-version: 0.3.0
#
# Reports Claude Code's state to the terminal it runs in, using invisible
# in-band escape sequences (iTerm2/WezTerm "SetUserVar" convention):
#
#   ESC ] 1337 ; SetUserVar=CLAUDE_PROJECT=<base64> BEL   (optional context)
#   ESC ] 1337 ; SetUserVar=CLAUDE_MSG=<base64> BEL       (optional context)
#   ESC ] 1337 ; SetUserVar=CLAUDE_STATE=<base64> BEL     (commits the update)
#
# The tabby-claude-state Tabby plugin strips them from the stream, colours the
# tab and shows notifications. Because they travel inside the tab's own byte
# stream, this works through WSL, SSH and tmux without any PID matching.
#
# Usage (from Claude Code hooks):  tabby-claude-state.sh <working|waiting|done|error|idle|notify>
# Never prints to stdout and always exits 0, so it can't affect Claude.

state="${1:-}"

# Hook payload (JSON) arrives on stdin.
input=""
if [ ! -t 0 ]; then
  input="$(cat 2>/dev/null)"
fi

case "$state" in
  notify)
    # Notification hook: only "Claude needs you right now" types count.
    case "$input" in
      *'"permission_prompt"'*|*'"elicitation_dialog"'*) state=waiting ;;
      *) exit 0 ;;
    esac
    ;;
  working)
    # Tools that block on the user are "waiting", not "working".
    case "$input" in
      *'"hook_event_name":"PreToolUse"'*'"tool_name":"AskUserQuestion"'*|\
      *'"hook_event_name":"PreToolUse"'*'"tool_name":"ExitPlanMode"'*|\
      *'"hook_event_name": "PreToolUse"'*'"tool_name": "AskUserQuestion"'*|\
      *'"hook_event_name": "PreToolUse"'*'"tool_name": "ExitPlanMode"'*) state=waiting ;;
    esac
    ;;
  waiting|done|error|idle) ;;
  *) exit 0 ;;
esac

# Find the terminal Claude is drawing on.
find_tty() {
  # 1) Controlling terminal (hooks normally stay in Claude's session).
  if { : >/dev/tty; } 2>/dev/null; then
    echo /dev/tty
    return 0
  fi
  # 2) Walk up the process tree looking for an ancestor with a pty on fd 0/1/2.
  local pid=$$ stat rest fd target i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    for fd in 0 1 2; do
      target="$(readlink "/proc/$pid/fd/$fd" 2>/dev/null)"
      case "$target" in
        /dev/pts/*|/dev/tty[0-9]*)
          if [ -w "$target" ]; then echo "$target"; return 0; fi
          ;;
      esac
    done
    stat="$(cat "/proc/$pid/stat" 2>/dev/null)" || return 1
    rest="${stat##*) }"            # drop "pid (comm) " safely, comm may contain spaces
    set -- $rest                   # $1=state $2=ppid
    pid="$2"
    case "$pid" in ''|0|1) return 1 ;; esac
  done
  return 1
}

tty="$(find_tty)" || exit 0

# Context for notifications: project name + a short human message.
# Uses python3 when available (proper JSON); degrades to project-only without it.
project="${PWD##*/}"
msg=""
if [ "$state" != working ] && [ "$state" != idle ] && [ -n "$input" ] && command -v python3 >/dev/null 2>&1; then
  ctx="$(TCS_STATE="$state" python3 -c '
import json, os, sys

def short(s, n):
    s = " ".join(str(s or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"

def tool_desc(name, inp):
    inp = inp if isinstance(inp, dict) else {}
    for k in ("command", "file_path", "path", "url", "pattern", "query", "description", "prompt"):
        v = inp.get(k)
        if isinstance(v, str) and v.strip():
            return "%s: %s" % (name, short(v, 120))
    return name

def last_assistant_text(path):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 512 * 1024))
            lines = f.read().decode("utf-8", "replace").splitlines()
    except Exception:
        return ""
    for line in reversed(lines):
        try:
            e = json.loads(line)
        except Exception:
            continue
        if e.get("type") != "assistant":
            continue
        content = (e.get("message") or {}).get("content")
        if isinstance(content, str) and content.strip():
            return content
        if isinstance(content, list):
            texts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
            text = " ".join(t for t in texts if t.strip())
            if text:
                return text
    return ""

try:
    d = json.loads(sys.stdin.read())
except Exception:
    sys.exit(0)

ev = d.get("hook_event_name", "")
st = os.environ.get("TCS_STATE", "")
ti = d.get("tool_input") if isinstance(d.get("tool_input"), dict) else {}
out = ""
if ev == "Notification":
    out = d.get("message", "")
elif ev == "PermissionRequest":
    out = "Permission: " + tool_desc(d.get("tool_name", "tool"), ti)
elif ev == "PreToolUse" and st == "waiting":
    if d.get("tool_name") == "AskUserQuestion":
        qs = ti.get("questions") or []
        out = "Question: " + (qs[0].get("question", "") if qs and isinstance(qs[0], dict) else "")
    else:
        out = "Plan ready for your review"
elif ev == "Stop":
    out = d.get("last_assistant_message") or last_assistant_text(d.get("transcript_path") or "")
elif ev == "StopFailure":
    out = d.get("error") or d.get("error_message") or d.get("message") or "API error"

cwd = d.get("cwd") or ""
print(os.path.basename(cwd.rstrip("/")) if cwd else "")
print(short(out, 200))
' <<<"$input" 2>/dev/null)"
  if [ -n "$ctx" ]; then
    p="${ctx%%$'\n'*}"
    [ -n "$p" ] && project="$p"
    case "$ctx" in *$'\n'*) msg="${ctx#*$'\n'}" ;; esac
  fi
fi

b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
osc() { printf '\033]1337;SetUserVar=%s=%s\007' "$1" "$(b64 "$2")"; }

seq="$(osc CLAUDE_PROJECT "$project")$(osc CLAUDE_MSG "$msg")$(osc CLAUDE_STATE "$state")"

if [ -n "${TMUX:-}" ]; then
  # tmux passthrough: ESC P tmux; <seq with ESC doubled> ESC \   (needs `set -g allow-passthrough on`)
  esc=$'\033'
  seq="${esc}Ptmux;${seq//$esc/$esc$esc}${esc}\\"
fi

# One write, so it can't be split in the middle of Claude's own output.
printf '%s' "$seq" >"$tty" 2>/dev/null
exit 0
