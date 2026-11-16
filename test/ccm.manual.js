// Manual integration check (Windows + WSL): node test/ccm.manual.js [--launch]
// Lists CCM Profiles per WSL distro through the same service the plugin uses, and with
// --launch runs the generated "Claude · <profile>" command line (with -p swapped in)
// through Tabby's own node-pty/ConPTY, printing the state vars the hooks emit.
const Module = require('module')
const orig = Module._load
Module._load = function (r, ...a) {
  if (r === 'tabby-core') return { HostAppService: class {}, Platform: { Windows: 'Windows' } }
  return orig.call(this, r, ...a)
}
const { HookInstallerService } = require('../dist/hookInstaller.service')
const { CcmService } = require('../dist/ccm.service')
const L = require('../dist/claudeLaunch')
;(async () => {
  const installer = new HookInstallerService({ platform: 'Windows' })
  const ccm = new CcmService(installer)
  await ccm.refresh()
  for (const d of ccm.snapshot) {
    console.log(`WSL · ${d.target.distro}:`, JSON.stringify(d.state))
  }
  if (!process.argv.includes('--launch')) return
  const d = ccm.snapshot.find(x => x.state && x.state.kind === 'ok' && x.state.list.profiles.length)
  const distro = d ? d.target.distro : ccm.snapshot[0].target.distro
  const forced = (process.argv.find(a => a.startsWith('--profile=')) || '').slice('--profile='.length)
  const profile = forced || (d ? d.state.list.profiles[0].profile : null)
  const args = L.wslArgs(profile, { distro, folder: '~', skipPermissions: true })
  // Non-interactive variant of the exact same command: add -p and a prompt.
  args[args.length - 1] = args[args.length - 1].replace(' -- claude', ' -- claude -p --model haiku "Reply with just: pong"').replace('exec claude', 'exec claude -p --model haiku "Reply with just: pong"')
  console.log('launching:', JSON.stringify(args))
  const pty = require('C:/Users/pedro/AppData/Local/Programs/Tabby/resources/app.asar.unpacked/node_modules/node-pty')
  const p = pty.spawn('C:/WINDOWS/system32/wsl.exe', args, { cols: 120, rows: 30, useConptyDll: true, env: { ...process.env, TERM: 'xterm-color' } })
  let out = ''
  p.onData(x => { out += x })
  p.onExit(({ exitCode }) => {
    const re = /\x1b\]1337;SetUserVar=CLAUDE_([A-Z]+)=([A-Za-z0-9+/=]*)(\x07|\x1b\\)/g
    const vars = [...out.matchAll(re)].map(m => m[1] + '=' + JSON.stringify(Buffer.from(m[2], 'base64').toString()))
    console.log('exit', exitCode, '\nvars:\n  ' + (vars.join('\n  ') || '(none)'))
    process.exit(0)
  })
  setTimeout(() => { console.log('timeout', JSON.stringify(out.slice(-400))); process.exit(1) }, 120000)
})().catch(e => { console.error('ERROR', e); process.exit(1) })
