# tabby-claude-state

See at a glance what every Claude Code session in [Tabby](https://tabby.sh) is doing, and get notified when one needs you.

- **Coloured tabs**: blue while Claude works (with an animated sweep), orange when it needs you, green when it's done, red on errors.
- **Native notifications**: Windows toasts (or macOS/Linux ones) with the permission request, question or final reply, the project name and how long the turn took. Clicking one jumps to that tab, or to the right pane in a split.
- **Taskbar flash** while Tabby is in the background.
- **Settings page** (Settings → Claude Code) that finds your WSL distros and installs, updates or removes the Claude Code hooks with one click.
- Works with Claude inside **WSL**, over **SSH** and through **tmux**. There's no process-ID matching, so any number of sessions works.

| State | When | Tab | Notification |
|---|---|---|---|
| Working | prompt submitted, tools running | blue + sweep | – |
| Needs you | permission prompt, `AskUserQuestion`, plan approval | orange + dot | "Claude needs you · project": *Permission: Bash: npm test* |
| Done | Claude finished its turn | green + dot, clears after you look | "Claude finished · project (4m 12s)": *final reply* |
| Error | API request failed | red + dot | "Claude hit an error · project" |

## Install

1. **Plugin:** in Tabby, open Settings → Plugins, search for **claude-state**, install it, and restart Tabby.
2. **Hooks:** open Settings → **Claude Code** → *Connect Claude Code* and click **Install** next to each WSL distro you use. Then restart any `claude` sessions that were already running.

That's it. Notifications, colours and behaviour are all on the same settings page.

<details>
<summary>Other setups (SSH hosts, Linux/macOS, building from source)</summary>

**Hooks on an SSH host, or manually:** you need `bash`, `base64` and `python3`. `python3` is used by the installer and to build notification text.
```bash
git clone https://github.com/PedroRF2008/tabby-claude-state
bash tabby-claude-state/scripts/install-hooks.sh          # --uninstall to remove
```
The script copies the hook to `~/.claude/hooks/` and merges the hook entries into `~/.claude/settings.json`. It backs up the file first, is safe to re-run, and leaves your other hooks alone.

**tmux:** add `set -g allow-passthrough on` to `~/.tmux.conf` (needs tmux 3.3+).

**Plugin from source (Windows):**
```powershell
git clone https://github.com/PedroRF2008/tabby-claude-state; cd tabby-claude-state
powershell -ExecutionPolicy Bypass -File scripts\install.ps1   # builds + copies into %APPDATA%\tabby\plugins
```
</details>

## How it works

```
claude (WSL / SSH / local) ──hook──▶ tabby-claude-state.sh
     writes to Claude's own pty:  ESC]1337;SetUserVar=CLAUDE_PROJECT=<b64> BEL
                                  ESC]1337;SetUserVar=CLAUDE_MSG=<b64> BEL
                                  ESC]1337;SetUserVar=CLAUDE_STATE=<b64> BEL
                                         ▼
Tabby session byte stream ──▶ ClaudeStateMiddleware  (strips them, emits {state, message, project})
                                         ▼
                              ClaudeStateDecorator ──▶ tab colour · progress · activity dot · flash
                                         ▼
                              ClaudeNotifierService ──▶ native notification (click → tab/pane)
```

The state travels inside the tab's own output, so each tab only ever shows its own session. The hook finds Claude's terminal through `/dev/tty`, or by walking up to an ancestor process's pty. It writes everything in a single `write()`, never prints to stdout, and always exits 0. The plugin's middleware is placed ahead of Tabby's built-in OSC processor, which would otherwise discard unknown `OSC 1337` sequences.

Hook mapping: `UserPromptSubmit`/`PreToolUse`/`PostToolUse(Failure)` → working, `PermissionRequest`/`Notification(permission_prompt, elicitation_dialog)` → needs you, `Stop` → done, `StopFailure` → error, `SessionEnd` → idle.

## Multiple accounts (`CLAUDE_CONFIG_DIR`, CCM)

The hook is always installed at `~/.claude/hooks/` and referenced as `"$HOME/.claude/hooks/…"`, so it runs the same under every identity. The installer edits the `settings.json` of `$CLAUDE_CONFIG_DIR` (or `~/.claude`), and if that file is a link it edits the file the link points to.

- **Per-account config directories**: run `install-hooks.sh` once with each `CLAUDE_CONFIG_DIR` whose `settings.json` is a separate file.
- **CCM (claude-credentials-manager)**:
  - **Published Profiles** share `~/.claude`, so they pick the hooks up automatically.
  - **Local Profiles** link their `settings.json` to the real one, so they pick them up too.
  - The settings page lists your Local Profiles and warns about any whose `settings.json` is no longer a link.

## Configuration

Everything is on Settings → Claude Code. The values are stored in Tabby's `config.yaml` under `claudeState:`.

Toggle **Debug logging** there to log every state change to DevTools (Ctrl+Shift+Alt+I).

## Development

```bash
npm install && npm run build
npm test                          # loader checks + stream parser (chunk splits, terminators, passthrough)
bash test/hook.test.sh            # in WSL/Linux: tty discovery, state mapping, message extraction, tmux
node test/installer.manual.js     # Windows: lists WSL distros + hook status via the settings-page service
```

## Known limits

- **Split panes:** if one tab has several panes each running Claude, they share one tab header, so the last state written wins. Notifications still open the right pane.
- **Interrupts:** pressing Esc or Ctrl+C doesn't fire Claude's `Stop` hook, so the tab can stay blue or orange until the next prompt or `/exit`.
- **Native Windows:** Claude running directly in PowerShell isn't covered yet; WSL and SSH are.
- **Do Not Disturb:** Windows Focus Assist may hide notifications.

## License

MIT
