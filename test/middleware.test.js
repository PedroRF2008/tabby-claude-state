// Run: node test/middleware.test.js   (after npm run build)
const Module = require('module')
const { Subject } = require('rxjs')
class SessionMiddleware {
  constructor () { this.outputToTerminal = new Subject(); this.outputToSession = new Subject() }
  get outputToTerminal$ () { return this.outputToTerminal }
  feedFromSession (d) { this.outputToTerminal.next(d) }
  close () { this.outputToTerminal.complete() }
}
const origLoad = Module._load
Module._load = function (req, ...rest) {
  if (req === 'tabby-terminal') return { SessionMiddleware }
  return origLoad.call(this, req, ...rest)
}
const assert = require('assert')
const { ClaudeStateMiddleware } = require('../dist/middleware')
const seq = (s, st = '\x07') => `\x1b]1337;SetUserVar=CLAUDE_STATE=${Buffer.from(s).toString('base64')}${st}`

function run (chunks, waitMs = 0) {
  return new Promise(resolve => {
    const m = new ClaudeStateMiddleware(); const out = []; const states = []
    m.outputToTerminal$.subscribe(b => out.push(b.toString('latin1')))
    m.state$.subscribe(s => states.push(s))
    for (const c of chunks) m.feedFromSession(Buffer.from(c, 'latin1'))
    setTimeout(() => resolve({ out: out.join(''), states }), waitMs)
  })
}
;(async () => {
  let r = await run(['hello' + seq('working') + 'world'])
  assert.deepStrictEqual(r, { out: 'helloworld', states: ['working'] })

  const s = 'a' + seq('waiting', '\x1b' + String.fromCharCode(92)) + 'b'
  for (let i = 1; i < s.length; i++) {           // every possible split point
    r = await run([s.slice(0, i), s.slice(i)])
    assert.deepStrictEqual(r, { out: 'ab', states: ['waiting'] }, 'split at ' + i)
  }
  r = await run(['x\x1b]0;title\x07\x1b[31my'])   // other OSC / CSI untouched
  assert.deepStrictEqual(r, { out: 'x\x1b]0;title\x07\x1b[31my', states: [] })
  r = await run(['tail\x1b'], 120)                // lone ESC at end is flushed
  assert.deepStrictEqual(r, { out: 'tail\x1b', states: [] })
  r = await run([seq('bogus') + seq('done')])     // unknown state ignored but stripped
  assert.deepStrictEqual(r, { out: '', states: ['done'] })
  r = await run(['\x1b]1337;SetUserVar=CLAUDE_STATE=\x1b[0mZ'])  // malformed passes through
  assert.deepStrictEqual(r, { out: '\x1b]1337;SetUserVar=CLAUDE_STATE=\x1b[0mZ', states: [] })
  console.log('middleware tests: all passed')
})().catch(e => { console.error(e); process.exit(1) })
