#!/usr/bin/env bash
# Run inside WSL/Linux: bash test/hook.test.sh
# Uses `script` to give the hook a real pty and checks what it writes there.
set -u
HOOK="$(cd "$(dirname "$0")/.." && pwd)/hooks/tabby-claude-state.sh"
fail=0

expect() { # name, expected-state-or-empty, command-run-under-a-pty
  local name="$1" want="$2" cmd="$3" got
  got="$(script -qec "$cmd" /dev/null | tr -d '\r' | grep -ao 'CLAUDE_STATE=[A-Za-z0-9+/=]*' | head -1 | cut -d= -f2- | base64 -d 2>/dev/null)"
  if [ "$got" = "$want" ]; then echo "ok   $name${want:+ -> $want}"; else echo "FAIL $name: want '$want' got '$got'"; fail=1; fi
}

expect "controlling tty"         working "echo '{}' | bash '$HOOK' working"
expect "no ctty, walk up to pty" done    "setsid -w bash -c \"echo '{}' | bash '$HOOK' done >/dev/null 2>&1 </dev/null\""
expect "notify permission"       waiting "echo '{\"notification_type\":\"permission_prompt\"}' | bash '$HOOK' notify"
expect "notify idle ignored"     ""      "echo '{\"notification_type\":\"idle_prompt\"}' | bash '$HOOK' notify"
expect "AskUserQuestion=waiting" waiting "echo '{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"AskUserQuestion\"}' | bash '$HOOK' working"
expect "PostToolUse stays work"  working "echo '{\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"AskUserQuestion\"}' | bash '$HOOK' working"
expect "unknown arg ignored"     ""      "echo '{}' | bash '$HOOK' nonsense"

# Hook must never write to stdout (Claude would parse it).
out="$(echo '{}' | bash "$HOOK" working 2>/dev/null </dev/null)"
if [ -z "$out" ]; then echo "ok   silent stdout"; else echo "FAIL stdout not empty"; fail=1; fi

# tmux wrapping
got="$(script -qec "echo '{}' | TMUX=x bash '$HOOK' error" /dev/null | od -c | tr -s ' ' | head -2 | tr -d '\n')"
case "$got" in *"033 P t m u x ; 033 033 ]"*) echo "ok   tmux passthrough wrap";; *) echo "FAIL tmux wrap: $got"; fail=1;; esac

exit $fail
