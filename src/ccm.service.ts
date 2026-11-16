import { Injectable } from '@angular/core'
import { Observable, Subject } from 'rxjs'
import { HookInstallerService, HookTarget } from './hookInstaller.service'
import { CcmState, interpretCcmList } from './claudeLaunch'

export interface DistroCcm {
    target: HookTarget
    state: CcmState | null      // null = not checked yet
    checkedAt: number
}

const STALE_MS = 60_000

/**
 * Knows which CCM (claude-credentials-manager) Profiles each WSL distro has,
 * by running `ccm list --json` there. Cached, refreshed in the background so
 * Tabby's profile menu never waits on WSL.
 */
@Injectable()
export class CcmService {
    get changed$ (): Observable<void> { return this.changed }

    private changed = new Subject<void>()
    private distros: DistroCcm[] = []
    private targetsLoaded = false
    private inflight: Promise<void> | null = null

    constructor (private installer: HookInstallerService) { }

    /** What we know right now (possibly empty until the first refresh finishes). */
    get snapshot (): DistroCcm[] {
        return this.distros
    }

    /** Kicks a background refresh if nothing is cached or the cache is stale. */
    ensureFresh (): void {
        const stale = !this.targetsLoaded || this.distros.some(d => Date.now() - d.checkedAt > STALE_MS)
        if (stale && !this.inflight) {
            this.refresh().catch(e => console.warn('[tabby-claude-state] ccm refresh failed', e))
        }
    }

    /** Re-reads the distro list and every distro's `ccm list --json`. */
    refresh (): Promise<void> {
        if (this.inflight) {
            return this.inflight
        }
        this.inflight = (async () => {
            const targets = (await this.installer.listTargets()).filter(t => t.kind === 'wsl')
            this.targetsLoaded = true
            const next: DistroCcm[] = targets.map(target => ({
                target,
                state: this.distros.find(d => d.target.id === target.id)?.state ?? null,
                checkedAt: 0,
            }))
            this.distros = next
            this.changed.next()
            await Promise.all(next.map(async d => {
                d.state = await this.query(d.target)
                d.checkedAt = Date.now()
            }))
            this.changed.next()
        })().finally(() => { this.inflight = null })
        return this.inflight
    }

    private async query (target: HookTarget): Promise<CcmState> {
        try {
            // `command -v` first, so a missing ccm is told apart from a broken one.
            const r = await this.installer.runBashRaw(target,
                'command -v ccm >/dev/null 2>&1 || exit 127\nccm list --json', 60_000)
            return interpretCcmList(r.code, r.stdout, r.stderr)
        } catch (e: any) {
            return { kind: 'error', detail: String(e?.message ?? e) }
        }
    }
}
