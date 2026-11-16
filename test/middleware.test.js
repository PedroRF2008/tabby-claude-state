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
const ST = '\x1b' + String.fromCharCode(92)
const v = (name, s, term = '\x07') => `\x1b]1337;SetUserVar=CLAUDE_${name}=${Buffer.from(s).toString('base64')}${term}`
const seq = (s, term) => v('STATE', s, term)
const ev = (state, message = '', project = '') => ({ state, message, project })

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
  assert.deepStrictEqual(r, { out: 'helloworld', states: [ev('working')] })

  const s = 'a' + seq('waiting', ST) + 'b'
  for (let i = 1; i < s.length; i++) {           // every possible split point
    r = await run([s.slice(0, i), s.slice(i)])
    assert.deepStrictEqual(r, { out: 'ab', states: [ev('waiting')] }, 'split at ' + i)
  }

  // context vars (UTF-8 message) attach to the next STATE, then reset
  const msg = 'Permission: Bash: rm -rf build — ação'
  const full = v('PROJECT', 'my-proj') + v('MSG', msg) + seq('waiting') + 'x' + seq('working')
  for (let i = 1; i < full.length; i += 7) {
    r = await run([full.slice(0, i), full.slice(i)])
    assert.deepStrictEqual(r, { out: 'x', states: [ev('waiting', msg, 'my-proj'), ev('working')] }, 'ctx split at ' + i)
  }

  r = await run(['x\x1b]0;title\x07\x1b[31my'])   // other OSC / CSI untouched
  assert.deepStrictEqual(r, { out: 'x\x1b]0;title\x07\x1b[31my', states: [] })
  r = await run(['x\x1b]1337;CurrentDir=/tmp\x07y'])   // Tabby's own 1337 untouched
  assert.deepStrictEqual(r, { out: 'x\x1b]1337;CurrentDir=/tmp\x07y', states: [] })
  r = await run(['tail\x1b'], 120)                // lone ESC at end is flushed
  assert.deepStrictEqual(r, { out: 'tail\x1b', states: [] })
  r = await run([seq('bogus') + seq('done')])     // unknown state ignored but stripped
  assert.deepStrictEqual(r, { out: '', states: [ev('done')] })
  r = await run(['\x1b]1337;SetUserVar=CLAUDE_STATE=\x1b[0mZ'])  // malformed passes through
  assert.deepStrictEqual(r, { out: '\x1b]1337;SetUserVar=CLAUDE_STATE=\x1b[0mZ', states: [] })
  r = await run(['\x1b]1337;SetUserVar=CLAUDE_X=abc\r\nmore'])   // control char → not ours
  assert.deepStrictEqual(r, { out: '\x1b]1337;SetUserVar=CLAUDE_X=abc\r\nmore', states: [] })
  console.log('middleware tests: all passed')
})().catch(e => { console.error(e); process.exit(1) })
