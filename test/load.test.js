// Run: node test/load.test.js  — mimics Tabby's plugin loader checks + module evaluation
const Module = require('module'); const assert = require('assert'); const path = require('path')
const info = require('../package.json')
const author = info.author; assert.ok(author && (author.name || author), 'package.json needs "author" (Tabby reads author.name)')
assert.ok(info.keywords.includes('tabby-plugin'))
assert.ok(info.name.startsWith('tabby-'), 'Tabby only scans packages named tabby-*')
for (const f of info.files) assert.ok(require('fs').existsSync(path.join(__dirname, '..', f)), 'missing packaged path ' + f)
class Stub {} ; class SessionMiddleware { constructor () {} }
class TerminalDecorator { detach () {} subscribeUntilDetached () {} }
const Platform = { Windows: 'Windows' }
const stubs = {
  'tabby-core': { __esModule: true, default: class TabbyCoreModule {}, ConfigProvider: Stub, ConfigService: Stub, HostWindowService: Stub, AppService: Stub, HostAppService: Stub, BaseTabComponent: Stub, NotificationsService: Stub, ProfilesService: Stub, Platform },
  'tabby-terminal': { TerminalDecorator, SessionMiddleware },
  'tabby-settings': { SettingsTabProvider: Stub },
  'tabby-local': { ShellProvider: class ShellProvider {} },
  '@angular/common': { CommonModule: class CommonModule {} },   // needs JIT compiler outside Tabby
  '@angular/forms': { FormsModule: class FormsModule {} },
}
const orig = Module._load
Module._load = function (r, ...a) { return stubs[r] ?? orig.call(this, r, ...a) }
const m = require(path.join('..', info.main))
assert.strictEqual(typeof m.default, 'function', 'plugin must have a default export (NgModule)')
const { PLUGIN_VERSION } = require('../dist/hookInstaller.service')
assert.strictEqual(PLUGIN_VERSION, info.version, 'plugin reads its own version')
const hook = require('fs').readFileSync(path.join(__dirname, '..', 'hooks', 'tabby-claude-state.sh'), 'utf8')
assert.ok(hook.includes('# tabby-claude-state-version: ' + info.version), 'hook version marker must match package version')
console.log('load test: ok')
