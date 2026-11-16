import { Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { Shell, ShellProvider } from 'tabby-local'
import { CcmService } from './ccm.service'
import { LaunchOptions, shellId, wslArgs } from './claudeLaunch'

const WSL = 'C:\\WINDOWS\\system32\\wsl.exe'

/**
 * Adds "Claude · <CCM Profile>" entries to Tabby's profiles (New tab menu,
 * Ctrl+Shift+E). Implemented as a ShellProvider so Tabby's own local launcher
 * opens them (profile id `local:claude-ccm:<distro>:<profile>`) — no extra
 * profile type shows up in Settings → Profiles → New.
 */
@Injectable()
export class ClaudeShellProvider extends ShellProvider {
    constructor (
        private ccm: CcmService,
        private config: ConfigService,
    ) {
        super()
    }

    private get launch (): any {
        return (this.config.store as any).claudeState?.launch ?? {}
    }

    async provide (): Promise<Shell[]> {
        const launch = this.launch
        if (launch.enabled === false || process.platform !== 'win32') {
            return []
        }
        // Never block the menu on WSL: answer from cache, refresh in the background.
        this.ccm.ensureFresh()

        const distros = this.ccm.snapshot
        const multi = distros.length > 1
        const shells: Shell[] = []
        for (const d of distros) {
            const distro = d.target.distro!
            if (launch.distro && launch.distro !== distro) {
                continue
            }
            const opts: LaunchOptions = {
                distro,
                folder: launch.folder || '~',
                skipPermissions: launch.skipPermissions !== false,
            }
            const suffix = multi && !launch.distro ? ` (${distro})` : ''
            const make = (profile: string | null, name: string): Shell => ({
                id: shellId(distro, profile),
                name: name + suffix,
                command: WSL,
                args: wslArgs(profile, opts),
                env: {},
                fsBase: `\\\\wsl$\\${distro}`,
                // In Tabby >= 1.0.238 but not in the published tabby-local typings.
                shellType: 'unix',
            } as Shell)

            if (d.state?.kind === 'ok') {
                shells.push(make(null, 'Claude · Active CCM Profile'))
                for (const p of d.state.list.profiles) {
                    shells.push(make(p.profile, `Claude · ${p.profile}`))
                }
            } else if (d.state && d.state.kind !== 'error') {
                // No (usable) ccm: still offer plain Claude Code.
                shells.push(make(null, 'Claude Code'))
            }
        }
        return shells
    }
}
