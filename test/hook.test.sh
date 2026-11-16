#!/usr/bin/env bash
# Run inside WSL/Linux: bash test/hook.test.sh
# Uses `script` to give the hook a real pty and checks what it writes there.
set -u
HOOK="$(cd "$(dirname "$0")/.." && pwd)/hooks/tabby-claude-state.sh"
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
fail=0

# var NAME from captured pty output
getvar() { tr -d '\r' | grep -ao "CLAUDE_$1=[A-Za-z0-9+/=]*" | head -1 | cut -d= -f2- | base64 -d 2>/dev/null; }

expect() { # name, var, expected, command-run-under-a-pty
  local name="$1" var="$2" want="$3" cmd="$4" got
  got="$(script -qec "$cmd" /dev/null | getvar "$var")"
  if [ "$got" = "$want" ]; then echo "ok   $name${want:+ -> $want}"; else echo "FAIL $name: want '$want' got '$got'"; fail=1; fi
}
J() { printf '%q' "$1"; }   # shell-quote a JSON payload

expect "controlling tty"         STATE working "echo '{}' | bash '$HOOK' working"
expect "no ctty, walk up to pty" STATE done    "setsid -w bash -c \"echo '{}' | bash '$HOOK' done >/dev/null 2>&1 </dev/null\""
expect "notify permission"       STATE waiting "echo '{\"notification_type\":\"permission_prompt\"}' | bash '$HOOK' notify"
expect "notify idle ignored"     STATE ""      "echo '{\"notification_type\":\"idle_prompt\"}' | bash '$HOOK' notify"
expect "AskUserQuestion=waiting" STATE waiting "echo '{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"AskUserQuestion\"}' | bash '$HOOK' working"
expect "PostToolUse stays work"  STATE working "echo '{\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"AskUserQuestion\"}' | bash '$HOOK' working"
expect "unknown arg ignored"     STATE ""      "echo '{}' | bash '$HOOK' nonsense"

# --- context: project + message (needs python3) ---
p='{"hook_event_name":"PermissionRequest","cwd":"/home/u/my-app","tool_name":"Bash","tool_input":{"command":"npm   test\n --watch"}}'
expect "permission message"      MSG     "Permission: Bash: npm test --watch" "printf '%s' $(J "$p") | bash '$HOOK' waiting"
expect "project from cwd"        PROJECT "my-app"  "printf '%s' $(J "$p") | bash '$HOOK' waiting"
p='{"hook_event_name":"Notification","notification_type":"permission_prompt","message":"Claude needs your permission to use Write"}'
expect "notification message"    MSG     "Claude needs your permission to use Write" "printf '%s' $(J "$p") | bash '$HOOK' notify"
p='{"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"Which DB?"}]}}'
expect "question message"        MSG     "Question: Which DB?" "printf '%s' $(J "$p") | bash '$HOOK' working"
p='{"hook_event_name":"Stop","last_assistant_message":"All done, tests pass."}'
expect "stop: last message"      MSG     "All done, tests pass." "printf '%s' $(J "$p") | bash '$HOOK' done"
printf '%s\n' '{"type":"user","message":{"content":"hi"}}' \
  '{"type":"assistant","message":{"content":[{"type":"text","text":"Fixed the bug."},{"type":"tool_use","name":"x"}]}}' \
  '{"type":"system"}' >"$TMPD/t.jsonl"
p="{\"hook_event_name\":\"Stop\",\"transcript_path\":\"$TMPD/t.jsonl\"}"
expect "stop: from transcript"   MSG     "Fixed the bug." "printf '%s' $(J "$p") | bash '$HOOK' done"
long="$(printf 'x%.0s' $(seq 1 400))"
p="{\"hook_event_name\":\"Stop\",\"last_assistant_message\":\"$long\"}"
got="$(script -qec "printf '%s' $(J "$p") | bash '$HOOK' done" /dev/null | getvar MSG)"
[ "${#got}" -eq 200 ] && echo "ok   long message truncated to 200" || { echo "FAIL truncation: ${#got}"; fail=1; }
expect "working sends no msg"    MSG     "" "echo '{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\"}' | bash '$HOOK' working"
expect "bad json still works"    STATE   done "echo 'not json' | bash '$HOOK' done"

# Hook must never write to stdout (Claude would parse it).
out="$(echo '{}' | bash "$HOOK" working 2>/dev/null </dev/null)"
if [ -z "$out" ]; then echo "ok   silent stdout"; else echo "FAIL stdout not empty"; fail=1; fi

# tmux wrapping
got="$(script -qec "echo '{}' | TMUX=x bash '$HOOK' error" /dev/null | od -c | tr -s ' ' | head -2 | tr -d '\n')"
case "$got" in *"033 P t m u x ; 033 033 ]"*) echo "ok   tmux passthrough wrap";; *) echo "FAIL tmux wrap: $got"; fail=1;; esac

exit $fail
