import { Injectable } from '@angular/core'
import { ConfigProvider } from 'tabby-core'

/** Defaults; override under `claudeState:` in Tabby's config.yaml. */
@Injectable()
export class ClaudeStateConfigProvider extends ConfigProvider {
    defaults = {
        claudeState: {
            enabled: true,
            colors: {
                working: '#3b82f6',
                waiting: '#f59e0b',
                done: '#22c55e',
                error: '#ef4444',
            },
            /** Animated sweep in the tab header while Claude works */
            progress: true,
            /** Activity dot for waiting / done / error */
            activityDot: true,
            /** Flash the taskbar button when the window is unfocused */
            flash: ['waiting', 'done', 'error'],
            /** "done" stays until you look at the tab, then clears after this delay */
            doneClearDelayMs: 2500,
            /** Log every state change to DevTools console */
            debug: false,
        },
    }
}
