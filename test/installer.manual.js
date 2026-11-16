// Manual integration check (Windows + WSL): node test/installer.manual.js [--install]
// Exercises the same service the settings page uses, against your real WSL distros.
const Module = require('module')
const orig = Module._load
Module._load = function (r, ...a) {
  if (r === 'tabby-core') return { HostAppService: class {}, Platform: { Windows: 'Windows' } }
  return orig.call(this, r, ...a)
}
const { HookInstallerService, PLUGIN_VERSION } = require('../dist/hookInstaller.service')
;(async () => {
  const svc = new HookInstallerService({ platform: process.platform === 'win32' ? 'Windows' : 'Linux' })
  const targets = await svc.listTargets()
  console.log('plugin', PLUGIN_VERSION, 'targets:', targets.map(t => t.label))
  for (const t of targets) {
    console.log('status before:', t.label, await svc.status(t))
    if (process.argv.includes('--install')) {
      console.log((await svc.install(t)).trim())
      console.log('status after:', t.label, await svc.status(t))
    }
  }
})().catch(e => { console.error('ERROR', e); process.exit(1) })
