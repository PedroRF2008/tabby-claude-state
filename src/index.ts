import { NgModule } from '@angular/core'
import { ConfigProvider } from 'tabby-core'
import { TerminalDecorator } from 'tabby-terminal'
import { ClaudeStateConfigProvider } from './config'
import { ClaudeStateDecorator } from './decorator'

@NgModule({
    providers: [
        { provide: TerminalDecorator, useClass: ClaudeStateDecorator, multi: true },
        { provide: ConfigProvider, useClass: ClaudeStateConfigProvider, multi: true },
    ],
})
export default class ClaudeStateModule { }
