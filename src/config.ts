import { Injectable } from '@angular/core'
import { ConfigProvider } from 'tabby-core'

export const DEFAULT_COLORS = {
    working: '#3b82f6',
    waiting: '#f59e0b',
    done: '#22c55e',
    error: '#ef4444',
}

/** Defaults; editable in Settings → Claude Code, stored under `claudeState:` in config.yaml. */
@Injectable()
export class ClaudeStateConfigProvider extends ConfigProvider {
    defaults = {
        claudeState: {
            enabled: true,
            colors: { ...DEFAULT_COLORS },
            /** Animated sweep in the tab header while Claude works */
            progress: true,
            /** Activity dot for waiting / done / error */
            activityDot: true,
            /** Flash the taskbar button when the window is unfocused */
            flash: { waiting: true, done: true, error: true },
            /** Native OS notifications */
            toast: {
                waiting: true,
                done: true,
                error: true,
                /** Skip the toast when you're already looking at that tab */
                onlyWhenUnseen: true,
                /** Include Claude's message (permission request, question, final reply) */
                showMessage: true,
                /** Don't toast "done" for turns shorter than this (seconds) */
                doneMinSeconds: 0,
                silent: false,
            },
            /** "done" stays until you look at the tab, then clears after this delay */
            doneClearDelayMs: 2500,
            /** Log every state change to DevTools console */
            debug: false,
        },
    }
}
