import { Injectable } from '@angular/core'
import { HostAppService, Platform } from 'tabby-core'
import * as childProcess from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

/** Where Claude Code runs and the hooks need installing. */
export interface HookTarget {
    id: string
    label: string
    kind: 'wsl' | 'local'
    distro?: string
}

export interface HookStatus {
    reachable: boolean
    python: boolean
    claude: boolean
    /** Version marker of the installed hook script, '' if missing */
    hookVersion: string
    /** Hook entries present in ~/.claude/settings.json */
    configured: boolean
    /** CCM (claude-credentials-manager) is set up on this target */
    ccm: boolean
    /** CCM Local Profiles whose settings.json links to the real one (hooks apply) */
    ccmShared: string[]
    /** CCM Local Profiles with their own settings.json (hooks won't run there) */
    ccmUnlinked: string[]
    error?: string
}

export const PLUGIN_ROOT = path.join(__dirname, '..')
export const PLUGIN_VERSION: string = (() => {
    try {
        return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8')).version
    } catch {
        return '0.0.0'
    }
})()
const INSTALL_SCRIPT = path.join(PLUGIN_ROOT, 'scripts', 'install-hooks.sh')

// Hook script: always $HOME/.claude/hooks (see install-hooks.sh). Settings: the
// config dir's settings.json, followed through a link.
// CCM (claude-credentials-manager) Local Profiles run Claude with
// CLAUDE_CONFIG_DIR=<ccm config>/logins/<name>, whose settings.json is a link to
// the real one — that link is what carries our hooks into those Profiles, so we
// report any Local Profile where it's missing. Published Profiles share
// ~/.claude and need nothing.
const STATUS_SCRIPT = `
s="$(readlink -f "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json" 2>/dev/null)"
h="$HOME/.claude/hooks/tabby-claude-state.sh"
echo "reachable=yes"
command -v python3 >/dev/null 2>&1 && echo "python=yes" || echo "python=no"
command -v claude >/dev/null 2>&1 && echo "claude=yes" || echo "claude=no"
if [ -f "$h" ]; then
  v="$(sed -n 's/^# tabby-claude-state-version: //p' "$h" | head -1)"
  echo "hookVersion=\${v:-0.1.0}"
fi
grep -q 'tabby-claude-state.sh' "$s" 2>/dev/null && echo "configured=yes" || echo "configured=no"
ccm_dir="\${CCM_CONFIG_DIR:-\${XDG_CONFIG_HOME:-$HOME/.config}/ccm}"
if [ -d "$ccm_dir" ]; then
  echo "ccm=yes"
  shared=""; unlinked=""
  for l in "$ccm_dir"/logins/*/; do
    [ -d "$l" ] || continue
    n="$(basename "$l")"
    if [ -n "$s" ] && [ "$(readlink -f "$l/settings.json" 2>/dev/null)" = "$s" ]; then shared="$shared,$n"; else unlinked="$unlinked,$n"; fi
  done
  echo "ccmShared=\${shared#,}"
  echo "ccmUnlinked=\${unlinked#,}"
fi
`

/** Detects, installs and removes the Claude Code hook in WSL distros (or locally on Linux/macOS). */
@Injectable()
export class HookInstallerService {
    constructor (private hostApp: HostAppService) { }

    get isWindows (): boolean {
        return this.hostApp.platform === Platform.Windows
    }

    async listTargets (): Promise<HookTarget[]> {
        if (!this.isWindows) {
            return [{ id: 'local', label: 'This machine', kind: 'local' }]
        }
        let raw: string
        try {
            raw = await this.exec('wsl.exe', ['--list', '--quiet'], '', 15000, 'utf16le')
        } catch {
            return []
        }
        return raw
            .replace(/\0/g, '')
            .split(/\r?\n/)
            .map(s => s.trim())
            .filter(s => s && !/^docker-desktop/i.test(s))
            .map(distro => ({ id: `wsl:${distro}`, label: `WSL · ${distro}`, kind: 'wsl' as const, distro }))
    }

    async status (target: HookTarget): Promise<HookStatus> {
        const empty: HookStatus = {
            reachable: false, python: false, claude: false, hookVersion: '', configured: false,
            ccm: false, ccmShared: [], ccmUnlinked: [],
        }
        const list = (v?: string) => (v ?? '').split(',').map(x => x.trim()).filter(Boolean)
        try {
            const out = await this.runBash(target, STATUS_SCRIPT, 60000)
            const kv: Record<string, string> = {}
            for (const line of out.split(/\r?\n/)) {
                const i = line.indexOf('=')
                if (i > 0) {
                    kv[line.substring(0, i).trim()] = line.substring(i + 1).trim()
                }
            }
            return {
                reachable: kv.reachable === 'yes',
                python: kv.python === 'yes',
                claude: kv.claude === 'yes',
                hookVersion: kv.hookVersion ?? '',
                configured: kv.configured === 'yes',
                ccm: kv.ccm === 'yes',
                ccmShared: list(kv.ccmShared),
                ccmUnlinked: list(kv.ccmUnlinked),
            }
        } catch (e: any) {
            return { ...empty, error: String(e?.message ?? e) }
        }
    }

    install (target: HookTarget): Promise<string> {
        return this.runInstaller(target, '')
    }

    uninstall (target: HookTarget): Promise<string> {
        return this.runInstaller(target, '--uninstall')
    }

    private runInstaller (target: HookTarget, arg: string): Promise<string> {
        if (target.kind === 'wsl') {
            const win = INSTALL_SCRIPT.replace(/'/g, `'\\''`)
            return this.runBash(target, `bash "$(wslpath -u '${win}')" ${arg}`, 120000)
        }
        const local = INSTALL_SCRIPT.replace(/'/g, `'\\''`)
        return this.runBash(target, `bash '${local}' ${arg}`, 120000)
    }

    /** Runs a script in a login bash (so ~/.local/bin etc. are on PATH), fed via stdin to avoid quoting issues. */
    runBash (target: HookTarget, script: string, timeout: number): Promise<string> {
        return this.runBashRaw(target, script, timeout).then(r => {
            if (r.code !== 0) {
                throw new Error(r.stderr.trim() || r.stdout.trim() || `exit code ${r.code}`)
            }
            return r.stdout
        })
    }

    /** Like runBash, but never rejects on a non-zero exit: callers that need the exit code (e.g. `ccm list --json`). */
    runBashRaw (target: HookTarget, script: string, timeout: number): Promise<ExecResult> {
        if (target.kind === 'wsl') {
            return this.execRaw('wsl.exe', ['-d', target.distro!, '-e', 'bash', '-l', '-s'], script, timeout)
        }
        return this.execRaw('bash', ['-l', '-s'], script, timeout)
    }

    private exec (cmd: string, args: string[], stdin: string, timeout: number, encoding: BufferEncoding = 'utf8'): Promise<string> {
        return this.execRaw(cmd, args, stdin, timeout, encoding).then(r => {
            if (r.code !== 0) {
                throw new Error(r.stderr.replace(/\0/g, '').trim() || r.stdout.trim() || `exit code ${r.code}`)
            }
            return r.stdout
        })
    }

    private execRaw (cmd: string, args: string[], stdin: string, timeout: number, encoding: BufferEncoding = 'utf8'): Promise<ExecResult> {
        return new Promise((resolve, reject) => {
            const child = childProcess.execFile(cmd, args, { timeout, windowsHide: true, encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 },
                (err: any, stdout, stderr) => {
                    const out = Buffer.from(stdout as any).toString(encoding)
                    const errText = Buffer.from(stderr as any).toString(encoding)
                    if (err && typeof err.code !== 'number') {
                        // Spawn failure or timeout (code is a string like 'ENOENT', or killed)
                        reject(new Error(errText.replace(/\0/g, '').trim() || err.message))
                        return
                    }
                    resolve({ code: err ? err.code : 0, stdout: out, stderr: errText })
                })
            child.stdin?.end(stdin.replace(/\r\n/g, '\n'))
        })
    }
}

export interface ExecResult {
    code: number
    stdout: string
    stderr: string
}
