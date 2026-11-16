import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import TabbyCoreModule, { ConfigProvider } from 'tabby-core'
import { TerminalDecorator } from 'tabby-terminal'
import { SettingsTabProvider } from 'tabby-settings'
import { ClaudeStateConfigProvider } from './config'
import { ClaudeStateDecorator } from './decorator'
import { HookInstallerService } from './hookInstaller.service'
import { ClaudeNotifierService } from './notifier.service'
import { ClaudeStateSettingsTabProvider } from './settings'
import { ClaudeStateSettingsTabComponent } from './settingsTab.component'

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        TabbyCoreModule,
    ],
    providers: [
        ClaudeNotifierService,
        HookInstallerService,
        { provide: TerminalDecorator, useClass: ClaudeStateDecorator, multi: true },
        { provide: ConfigProvider, useClass: ClaudeStateConfigProvider, multi: true },
        { provide: SettingsTabProvider, useClass: ClaudeStateSettingsTabProvider, multi: true },
    ],
    declarations: [
        ClaudeStateSettingsTabComponent,
    ],
})
export default class ClaudeStateModule { }
