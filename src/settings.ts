import { Injectable } from '@angular/core'
import { SettingsTabProvider } from 'tabby-settings'
import { ClaudeStateSettingsTabComponent } from './settingsTab.component'

@Injectable()
export class ClaudeStateSettingsTabProvider extends SettingsTabProvider {
    id = 'claude-state'
    icon = 'robot'
    title = 'Claude Code'

    getComponentType (): any {
        return ClaudeStateSettingsTabComponent
    }
}
