// Run: node test/claudeLaunch.test.js   (after npm run build)
const assert = require('assert')
const L = require('../dist/claudeLaunch')

// --- name validation mirrors CCM's rule ---
for (const ok of ['imp', 'work-2', 'a.b_c', 'X'.repeat(64)]) assert.ok(L.isValidProfileName(ok), ok)
for (const bad of ['', '-x', '.hidden', 'a b', "o'neil", 'a;rm -rf', 'default', 'NONE', 'X'.repeat(65), '..', 'ação'])
  assert.ok(!L.isValidProfileName(bad), JSON.stringify(bad))

// --- quoting ---
assert.strictEqual(L.shQuote("it's"), `'it'\\''s'`)

// --- command building ---
assert.strictEqual(L.claudeCommand('imp', true), "exec ccm run 'imp' -- claude --dangerously-skip-permissions")
assert.strictEqual(L.claudeCommand('imp', false), "exec ccm run 'imp' -- claude")
assert.strictEqual(L.claudeCommand(null, true), 'exec claude --dangerously-skip-permissions')
assert.throws(() => L.claudeCommand('x; rm -rf ~', true), /invalid CCM Profile name/)
assert.deepStrictEqual(L.wslArgs('imp', { distro: 'Ubuntu', folder: '', skipPermissions: true }),
  ['-d', 'Ubuntu', '--cd', '~', '-e', 'bash', '-lic', "exec ccm run 'imp' -- claude --dangerously-skip-permissions"])
assert.deepStrictEqual(L.wslArgs(null, { distro: 'Debian', folder: '/home/u/proj', skipPermissions: false }).slice(0, 4),
  ['-d', 'Debian', '--cd', '/home/u/proj'])

// --- ids ---
assert.strictEqual(L.shellId('Ubuntu', 'imp'), 'claude-ccm:Ubuntu:imp')
assert.strictEqual(L.ccmProfileFromTabbyProfileId('local:claude-ccm:Ubuntu:imp'), 'imp')
assert.strictEqual(L.ccmProfileFromTabbyProfileId('local:claude-ccm:Ubuntu:@active'), null)
assert.strictEqual(L.ccmProfileFromTabbyProfileId('local:wsl-Ubuntu'), null)
assert.strictEqual(L.ccmProfileFromTabbyProfileId(undefined), null)

// --- interpreting `ccm list --json` ---
const json = JSON.stringify({
  activeProfile: 'imp',
  store: { enabled: false, status: 'off' },
  profiles: [
    { profile: 'imp', kind: 'local', account: 'imp@x.com', active: true, holder: null, expires: null, description: null },
    { profile: 'ncs', kind: 'published', account: 'ncs@x.com', active: false, holder: 'Ana', expires: '2027-01-01', description: 'group' },
    { profile: 'bad name', kind: 'local', account: 'x', active: false },   // dropped: invalid name
  ],
})
let s = L.interpretCcmList(0, json, '')
assert.strictEqual(s.kind, 'ok')
assert.deepStrictEqual(s.list.profiles.map(p => p.profile), ['imp', 'ncs'])
assert.strictEqual(s.list.activeProfile, 'imp')
assert.deepStrictEqual(s.list.store, { enabled: false, status: 'off' })
assert.strictEqual(s.list.profiles[1].kind, 'published')

assert.deepStrictEqual(L.interpretCcmList(127, '', 'bash: line 1: ccm: command not found'), { kind: 'missing' })
// old ccm: `list` takes no arguments → usage error, exit 2
s = L.interpretCcmList(2, '', 'ccm: `ccm list` não aceita argumentos\nUso: ccm list')
assert.strictEqual(s.kind, 'too-old')
// old ccm that ignored the flag and printed its table
assert.strictEqual(L.interpretCcmList(0, 'PERFIL  CONTA\nimp  imp@x.com', '').kind, 'too-old')
assert.strictEqual(L.interpretCcmList(3, '', '').kind, 'error')
assert.strictEqual(L.interpretCcmList(0, '{"nope":1}', '').kind, 'error')

console.log('claudeLaunch tests: all passed')
