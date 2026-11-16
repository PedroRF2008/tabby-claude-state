import { Injectable } from '@angular/core'
import { AppService, BaseTabComponent, ConfigService, HostWindowService } from 'tabby-core'
import { ClaudeState } from './middleware'

export interface ToastRequest {
    state: ClaudeState
    project: string
    message: string
    /** Milliseconds Claude spent working before this state (if known) */
    elapsedMs?: number
    /** Top-level tab (header) to select on click */
    tab?: BaseTabComponent
    /** CCM Profile the tab runs as (from a "Claude · <profile>" tab), if any */
    ccmProfile?: string | null
    /** Pane inside a split tab to focus on click */
    pane?: BaseTabComponent
}

const TITLES: Partial<Record<ClaudeState, string>> = {
    waiting: 'Claude needs you',
    done: 'Claude finished',
    error: 'Claude hit an error',
}
const FALLBACK_BODY: Partial<Record<ClaudeState, string>> = {
    waiting: 'Waiting for your input',
    done: 'Ready for your next prompt',
    error: 'The request failed',
}

export function formatDuration (ms: number): string {
    const s = Math.round(ms / 1000)
    if (s < 60) {
        return `${s}s`
    }
    const m = Math.floor(s / 60)
    if (m < 60) {
        return `${m}m ${s % 60}s`
    }
    return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** Native OS notifications (Windows toast / macOS / libnotify) via the HTML5 Notification API. */
@Injectable()
export class ClaudeNotifierService {
    constructor (
        private app: AppService,
        private config: ConfigService,
        private hostWindow: HostWindowService,
    ) { }

    private get cfg (): any {
        return (this.config.store as any).claudeState?.toast ?? {}
    }

    /** Applies the user's toast settings; returns true if a toast was shown. */
    maybeNotify (req: ToastRequest): boolean {
        const cfg = this.cfg
        if (!TITLES[req.state] || cfg[req.state] === false) {
            return false
        }
        if (req.state === 'done' && req.elapsedMs !== undefined && req.elapsedMs < (cfg.doneMinSeconds ?? 0) * 1000) {
            return false
        }
        if (cfg.onlyWhenUnseen !== false && this.isVisible(req.tab)) {
            return false
        }
        this.show(req)
        return true
    }

    /** Shows a toast unconditionally (used by the settings page "Test" buttons too). */
    show (req: ToastRequest): void {
        const cfg = this.cfg
        let title = TITLES[req.state] ?? 'Claude Code'
        if (req.project) {
            title += ` · ${req.project}`
        }
        if (req.ccmProfile) {
            title += ` · ${req.ccmProfile}`
        }
        if (req.state === 'done' && req.elapsedMs && req.elapsedMs >= 1000) {
            title += ` (${formatDuration(req.elapsedMs)})`
        }
        const body = (cfg.showMessage !== false && req.message) ? req.message : FALLBACK_BODY[req.state] ?? ''

        try {
            const n = new Notification(title, { body, silent: !!cfg.silent })
            n.addEventListener('click', () => this.reveal(req))
        } catch (e) {
            console.warn('[tabby-claude-state] notification failed', e)
        }
    }

    private isVisible (tab?: BaseTabComponent): boolean {
        const windowFocused = typeof document === 'undefined' || document.hasFocus()
        return windowFocused && !!tab && this.app.activeTab === tab
    }

    private reveal (req: ToastRequest): void {
        try {
            (this.hostWindow as any).bringToFront?.()
        } catch { /* best effort */ }
        if (req.tab && this.app.tabs.includes(req.tab)) {
            this.app.selectTab(req.tab)
            const split = req.tab as any
            if (req.pane && req.pane !== req.tab && typeof split.focus === 'function') {
                setTimeout(() => split.focus(req.pane))
            }
        }
    }
}
