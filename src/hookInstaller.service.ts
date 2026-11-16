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

const STATUS_SCRIPT = `
d="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
echo "reachable=yes"
command -v python3 >/dev/null 2>&1 && echo "python=yes" || echo "python=no"
command -v claude >/dev/null 2>&1 && echo "claude=yes" || echo "claude=no"
if [ -f "$d/hooks/tabby-claude-state.sh" ]; then
  v="$(sed -n 's/^# tabby-claude-state-version: //p' "$d/hooks/tabby-claude-state.sh" | head -1)"
  echo "hookVersion=\${v:-0.1.0}"
fi
grep -q 'tabby-claude-state.sh' "$d/settings.json" 2>/dev/null && echo "configured=yes" || echo "configured=no"
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
        const empty: HookStatus = { reachable: false, python: false, claude: false, hookVersion: '', configured: false }
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
    private runBash (target: HookTarget, script: string, timeout: number): Promise<string> {
        if (target.kind === 'wsl') {
            return this.exec('wsl.exe', ['-d', target.distro!, '-e', 'bash', '-l', '-s'], script, timeout)
        }
        return this.exec('bash', ['-l', '-s'], script, timeout)
    }

    private exec (cmd: string, args: string[], stdin: string, timeout: number, encoding: BufferEncoding = 'utf8'): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = childProcess.execFile(cmd, args, { timeout, windowsHide: true, encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 },
                (err, stdout, stderr) => {
                    const out = Buffer.from(stdout as any).toString(encoding)
                    if (err) {
                        const errText = Buffer.from(stderr as any).toString(encoding).replace(/\0/g, '').trim()
                        reject(new Error(errText || out.trim() || err.message))
                        return
                    }
                    resolve(out)
                })
            child.stdin?.end(stdin.replace(/\r\n/g, '\n'))
        })
    }
}
