import { Injectable, NgZone } from '@angular/core'
import { Subscription } from 'rxjs'
import { BaseTabComponent, ConfigService, HostWindowService } from 'tabby-core'
import { BaseTerminalTabComponent, TerminalDecorator } from 'tabby-terminal'
import { ClaudeState, ClaudeStateEvent, ClaudeStateMiddleware } from './middleware'
import { ClaudeNotifierService } from './notifier.service'
import { ccmProfileFromTabbyProfileId } from './claudeLaunch'

const SWEEP_INTERVAL_MS = 250
const SWEEP_STEP = 4

/** Accepts both the v0.1 array form and the v0.2 object form of `flash`. */
function flashEnabled (flash: any, state: ClaudeState): boolean {
    if (Array.isArray(flash)) {
        return flash.includes(state)
    }
    return !!flash?.[state]
}

/** Per-terminal controller: owns the visuals Claude's state puts on the tab header. */
class TabStateController {
    state: ClaudeState = 'idle'

    private target: BaseTabComponent | null = null
    private originalColor: string | null = null
    private sweepTimer: ReturnType<typeof setInterval> | null = null
    private sweepValue = 0
    private clearTimer: ReturnType<typeof setTimeout> | null = null
    private focusSubs: Subscription[] = []
    private workStartedAt: number | null = null

    constructor (
        private terminal: BaseTerminalTabComponent<any>,
        private config: ConfigService,
        private hostWindow: HostWindowService,
        private notifier: ClaudeNotifierService,
        private zone: NgZone,
    ) { }

    private get cfg (): any {
        return (this.config.store as any).claudeState ?? {}
    }

    apply (event: ClaudeStateEvent): void {
        this.zone.run(() => this.applyInZone(event))
    }

    destroy (): void {
        this.reset()
    }

    private applyInZone (event: ClaudeStateEvent): void {
        const { state } = event
        const cfg = this.cfg
        const prev = this.state
        if (cfg.debug) {
            console.log(`[tabby-claude-state] ${event.project || this.terminal.title || 'tab'}: ${prev} -> ${state}`, event.message)
        }
        if (cfg.enabled === false) {
            return
        }

        // Time how long Claude was busy, for the "done" toast.
        let elapsedMs: number | undefined
        if (state === 'working') {
            this.workStartedAt ??= Date.now()
        } else {
            if (this.workStartedAt !== null) {
                elapsedMs = Date.now() - this.workStartedAt
            }
            if (state !== 'waiting') {
                this.workStartedAt = null   // waiting is mid-turn; keep the clock running
            }
        }

        if (state === 'idle') {
            this.reset()
            return
        }

        // Header lives on the split container that wraps the terminal.
        const target = this.terminal.topmostParent ?? this.terminal
        if (this.target !== target) {
            this.reset()
            this.target = target
            this.originalColor = target.color
        }

        this.state = state
        this.cancelPendingClear()
        target.color = cfg.colors?.[state] ?? null

        if (state === 'working' && cfg.progress !== false) {
            this.startSweep()
        } else {
            this.stopSweep()
        }

        if (state === 'working') {
            target.clearActivity()
        } else if (cfg.activityDot !== false) {
            target.displayActivity()
        }

        if (state !== prev && state !== 'working') {
            const windowFocused = typeof document !== 'undefined' && document.hasFocus()
            if (!windowFocused && flashEnabled(cfg.flash, state)) {
                try {
                    // flashFrame exists in Tabby >= 1.0.238 but not in the published typings.
                    (this.hostWindow as any).flashFrame?.()
                } catch { /* best effort */ }
            }
            this.notifier.maybeNotify({
                state,
                project: event.project,
                message: event.message,
                elapsedMs,
                tab: target,
                pane: this.terminal,
                ccmProfile: ccmProfileFromTabbyProfileId((this.terminal as any).profile?.id),
            })
        }

        if (state === 'done') {
            this.armDoneClear(target)
        }
    }

    /** "Green until you look at it": clear once the tab (and window) are focused. */
    private armDoneClear (target: BaseTabComponent): void {
        const tryClear = () => {
            const windowFocused = typeof document === 'undefined' || document.hasFocus()
            if (this.state === 'done' && target.hasFocus && windowFocused && !this.clearTimer) {
                this.clearTimer = setTimeout(() => {
                    this.clearTimer = null
                    if (this.state === 'done') {
                        this.zone.run(() => this.reset())
                    }
                }, this.cfg.doneClearDelayMs ?? 2500)
            }
        }
        this.unsubscribeFocus()
        this.focusSubs.push(target.focused$.subscribe(() => tryClear()))
        this.focusSubs.push(this.hostWindow.windowFocused$.subscribe(() => tryClear()))
        tryClear()
    }

    private reset (): void {
        this.stopSweep()
        this.cancelPendingClear()
        this.unsubscribeFocus()
        if (this.target) {
            this.target.color = this.originalColor
            this.target.clearActivity()
        }
        this.target = null
        this.originalColor = null
        this.state = 'idle'
    }

    private startSweep (): void {
        if (this.sweepTimer || !this.target) {
            return
        }
        const target = this.target
        this.sweepValue = 0
        this.sweepTimer = setInterval(() => {
            // Re-emitting also keeps Tabby's 5 s progress auto-clear at bay.
            this.sweepValue = (this.sweepValue + SWEEP_STEP) % 104
            target.setProgress(Math.min(this.sweepValue, 100))
        }, SWEEP_INTERVAL_MS)
    }

    private stopSweep (): void {
        if (this.sweepTimer) {
            clearInterval(this.sweepTimer)
            this.sweepTimer = null
            this.target?.setProgress(null)
        }
    }

    private cancelPendingClear (): void {
        if (this.clearTimer) {
            clearTimeout(this.clearTimer)
            this.clearTimer = null
        }
    }

    private unsubscribeFocus (): void {
        for (const s of this.focusSubs) {
            s.unsubscribe()
        }
        this.focusSubs = []
    }
}

@Injectable()
export class ClaudeStateDecorator extends TerminalDecorator {
    private controllers = new Map<BaseTerminalTabComponent<any>, TabStateController>()

    constructor (
        private config: ConfigService,
        private hostWindow: HostWindowService,
        private notifier: ClaudeNotifierService,
        private zone: NgZone,
    ) {
        super()
        console.info('[tabby-claude-state] loaded')
    }

    attach (terminal: BaseTerminalTabComponent<any>): void {
        const controller = new TabStateController(terminal, this.config, this.hostWindow, this.notifier, this.zone)
        this.controllers.set(terminal, controller)

        setTimeout(() => {
            this.attachToSession(terminal, controller)
            this.subscribeUntilDetached(terminal, terminal.sessionChanged$.subscribe(() => {
                controller.apply({ state: 'idle', message: '', project: '' })
                this.attachToSession(terminal, controller)
            }))
        })
    }

    detach (terminal: BaseTerminalTabComponent<any>): void {
        this.controllers.get(terminal)?.destroy()
        this.controllers.delete(terminal)
        super.detach(terminal)
    }

    private attachToSession (terminal: BaseTerminalTabComponent<any>, controller: TabStateController): void {
        if (!terminal.session) {
            return
        }
        const middleware = new ClaudeStateMiddleware()
        // unshift: must run before Tabby's OSCProcessor, which eats unknown OSC 1337.
        terminal.session.middleware.unshift(middleware)
        this.subscribeUntilDetached(terminal, middleware.state$.subscribe(event => controller.apply(event)))
    }
}
