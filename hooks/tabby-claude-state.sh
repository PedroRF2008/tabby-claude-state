#!/usr/bin/env bash
# tabby-claude-state hook
#
# Reports Claude Code's state to the terminal it runs in, using an invisible
# in-band escape sequence (iTerm2/WezTerm "SetUserVar" convention):
#
#   ESC ] 1337 ; SetUserVar=CLAUDE_STATE=<base64(state)> BEL
#
# The tabby-claude-state Tabby plugin strips it from the stream and colours the
# tab. Because it travels inside the tab's own byte stream, it works through
# WSL, SSH and tmux (with allow-passthrough) without any PID matching.
#
# Usage (from Claude Code hooks):  tabby-claude-state.sh <working|waiting|done|error|idle|notify>
# Never prints to stdout and always exits 0, so it can't affect Claude.

state="${1:-}"

# Hook payload (JSON) arrives on stdin; we only grep it, no jq needed.
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

b64="$(printf '%s' "$state" | base64 | tr -d '\n')"
seq="$(printf '\033]1337;SetUserVar=CLAUDE_STATE=%s\007' "$b64")"

if [ -n "${TMUX:-}" ]; then
  # tmux passthrough: ESC P tmux; <seq with ESC doubled> ESC \   (needs `set -g allow-passthrough on`)
  esc=$'\033'
  seq="${esc}Ptmux;${seq//$esc/$esc$esc}${esc}\\"
fi

# One write, so it can't be split in the middle of Claude's own output.
printf '%s' "$seq" >"$tty" 2>/dev/null
exit 0
