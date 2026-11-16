# tabby-claude-state

Shows each Claude Code session's state on its Tabby tab. It works inside **WSL**, over **SSH** and through **tmux**, and it doesn't rely on matching process IDs.

| State | Trigger (Claude Code hook) | Tab |
|---|---|---|
| working | UserPromptSubmit, PreToolUse, PostToolUse(Failure) | blue bar + animated sweep |
| waiting | PermissionRequest, Notification (`permission_prompt`, `elicitation_dialog`), AskUserQuestion / ExitPlanMode | orange bar + activity dot + taskbar flash* |
| done | Stop | green bar + dot + flash*; clears ~2.5 s after you look at the tab |
| error | StopFailure (API error) | red bar + dot + flash* |
| idle | SessionEnd | original tab colour restored |

\* The taskbar only flashes when the Tabby window is unfocused.

## How it works

```
claude (WSL / SSH / local) ──hook──▶ tabby-claude-state.sh
                                         │ writes ESC]1337;SetUserVar=CLAUDE_STATE=<b64>BEL
                                         ▼  to Claude's own pty (/dev/tty, or an ancestor's pts)
Tabby session byte stream ──▶ ClaudeStateMiddleware (strips it, emits state)
                                         ▼
                              ClaudeStateDecorator ──▶ tab colour / progress / activity / flash
```

The state arrives inside the tab's own output, so every tab only ever shows its own session. The middleware is inserted at the front of the session middleware stack. Tabby's built-in `OSCProcessor` swallows unknown `OSC 1337` sequences, so ours has to run first.

## Install

**1. Tabby plugin (Windows, PowerShell):**
```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```
This builds the plugin and copies it to `%APPDATA%\tabby\plugins\node_modules\tabby-claude-state`. Restart Tabby afterwards.

**2. Claude Code hooks (inside WSL, or on any SSH host you run `claude` on):**
```bash
git clone https://github.com/pedrorf2008/tabby-claude-state
bash tabby-claude-state/scripts/install-hooks.sh
# or, from a Windows checkout: bash /mnt/c/<path-to>/tabby-claude-state/scripts/install-hooks.sh
```
This copies the hook to `~/.claude/hooks/` and merges the hook entries into `~/.claude/settings.json`. It backs the file up first, is safe to re-run, and leaves other hooks alone.
To remove it: `install-hooks.sh --uninstall`.

For an SSH host, copy the repo (or just `hooks/` and `scripts/`) there and run the same script. The host needs `bash`, `base64` and `python3` (python3 is only used by the installer).

**tmux:** add `set -g allow-passthrough on` to `~/.tmux.conf` (tmux 3.3+ required).

## Configuration

Optional. Add this to Tabby's `config.yaml` (`%APPDATA%\tabby\config.yaml`); the values shown are the defaults:

```yaml
claudeState:
  enabled: true
  colors: { working: '#3b82f6', waiting: '#f59e0b', done: '#22c55e', error: '#ef4444' }
  progress: true          # sweep animation while working
  activityDot: true
  flash: [waiting, done, error]
  doneClearDelayMs: 2500
  debug: false            # log state changes to DevTools (Ctrl+Shift+Alt+I)
```

## Manual test

In any Tabby tab (WSL shell):
```bash
for s in working waiting done error idle; do
  printf '\e]1337;SetUserVar=CLAUDE_STATE=%s\a' "$(printf $s | base64)"; sleep 2
done
```

## Development

```bash
npm install && npm run build
node test/middleware.test.js        # stream parser: chunk splits, terminators, passthrough
bash test/hook.test.sh              # (in WSL) hook: tty discovery, mapping, tmux wrap
```

## Known limits

- **Split panes:** if one tab has several panes each running Claude, they share one tab header, so the last state written wins.
- **Interrupts:** pressing Esc or Ctrl+C doesn't fire Claude's `Stop` hook, so the tab can stay blue or orange until the next prompt or `/exit`.
- **Native Windows:** Claude running directly in PowerShell isn't covered yet; WSL and SSH are.
