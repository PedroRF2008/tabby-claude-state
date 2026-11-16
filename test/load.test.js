// Run: node test/load.test.js  — mimics Tabby's plugin loader checks + module evaluation
const Module = require('module'); const assert = require('assert'); const path = require('path')
const info = require('../package.json')
const author = info.author; assert.ok(author && (author.name || author), 'package.json needs "author" (Tabby reads author.name)')
assert.ok(info.keywords.includes('tabby-plugin'))
class Stub {} ; class SessionMiddleware { constructor () {} }
class TerminalDecorator { detach () {} subscribeUntilDetached () {} }
const stubs = { 'tabby-core': { ConfigProvider: Stub, ConfigService: Stub, HostWindowService: Stub },
                'tabby-terminal': { TerminalDecorator, SessionMiddleware } }
const orig = Module._load
Module._load = function (r, ...a) { return stubs[r] ?? orig.call(this, r, ...a) }
const m = require(path.join('..', info.main))
assert.strictEqual(typeof m.default, 'function', 'plugin must have a default export (NgModule)')
console.log('load test: ok')
