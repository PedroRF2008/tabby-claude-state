/**
 * Pure helpers for "Claude Code as a CCM Profile" tabs: parsing `ccm list --json`,
 * validating Profile names and building the wsl.exe command line.
 * No Angular / Tabby imports, so it can be unit-tested with plain node.
 */

export interface CcmProfile {
    profile: string
    kind: 'local' | 'published'
    account: string
    active: boolean
    holder: string | null
    expires: string | null
    description: string | null
}

export type CcmStoreStatus = 'ok' | 'stale' | 'unreachable' | 'not-configured' | 'off'

export interface CcmList {
    activeProfile: string | null
    store: { enabled: boolean, status: CcmStoreStatus }
    profiles: CcmProfile[]
}

export type CcmState =
    | { kind: 'ok', list: CcmList }
    | { kind: 'missing' }            // ccm not on PATH in that distro
    | { kind: 'too-old', detail: string }   // ccm present, but no `list --json`
    | { kind: 'error', detail: string }

/** CCM's own rule (src/manifest.ts PROFILE_NAME + length + reserved words). */
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const RESERVED = ['default', 'none']

export function isValidProfileName (name: string): boolean {
    return typeof name === 'string'
        && PROFILE_NAME.test(name)
        && name.length <= 64
        && name !== '.' && name !== '..'
        && !RESERVED.includes(name.toLowerCase())
}

/** POSIX single-quoting: safe for any string. */
export function shQuote (s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Interprets the result of running `ccm list --json` in a login bash. */
export function interpretCcmList (code: number, stdout: string, stderr: string): CcmState {
    const out = stdout.trim()
    if (code === 127 || /ccm: (command )?not found/.test(stderr)) {
        return { kind: 'missing' }
    }
    let parsed: any
    try {
        parsed = JSON.parse(out)
    } catch {
        // An older ccm has no --json: it rejects the argument (usage error, exit 2)
        // or prints its table. Either way, not JSON.
        if (code === 2 || out.length > 0 || /usage|uso/i.test(stderr)) {
            return { kind: 'too-old', detail: firstLine(stderr) || firstLine(out) }
        }
        return { kind: 'error', detail: firstLine(stderr) || `exit code ${code}` }
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.profiles)) {
        return { kind: 'error', detail: 'unexpected `ccm list --json` output' }
    }
    const profiles: CcmProfile[] = parsed.profiles
        .filter((p: any) => p && typeof p.profile === 'string' && isValidProfileName(p.profile))
        .map((p: any) => ({
            profile: p.profile,
            kind: p.kind === 'published' ? 'published' : 'local',
            account: typeof p.account === 'string' ? p.account : '',
            active: !!p.active,
            holder: p.holder ?? null,
            expires: p.expires ?? null,
            description: p.description ?? null,
        }))
    return {
        kind: 'ok',
        list: {
            activeProfile: typeof parsed.activeProfile === 'string' ? parsed.activeProfile : null,
            store: {
                enabled: parsed.store?.enabled !== false,
                status: parsed.store?.status ?? 'ok',
            },
            profiles,
        },
    }
}

function firstLine (s: string): string {
    return (s || '').trim().split(/\r?\n/)[0] ?? ''
}

export interface LaunchOptions {
    distro: string
    /** WSL path to start in; '~' for home */
    folder: string
    skipPermissions: boolean
}

/** Id prefix of the shells we provide; Tabby turns a shell into profile `local:<shell id>`. */
export const SHELL_ID_PREFIX = 'claude-ccm:'

/** Shell id for a CCM Profile (null profile = whatever ccm's Active Profile is). */
export function shellId (distro: string, profile: string | null): string {
    return `${SHELL_ID_PREFIX}${distro}:${profile ?? '@active'}`
}

/** CCM Profile encoded in a Tabby profile id (`local:claude-ccm:<distro>:<profile>`), if any. */
export function ccmProfileFromTabbyProfileId (id: string | undefined | null): string | null {
    if (!id) {
        return null
    }
    const i = id.indexOf(SHELL_ID_PREFIX)
    if (i === -1) {
        return null
    }
    const rest = id.substring(i + SHELL_ID_PREFIX.length)
    const profile = rest.substring(rest.lastIndexOf(':') + 1)
    return profile === '@active' ? null : profile
}

/** The bash -c script run inside WSL. */
export function claudeCommand (profile: string | null, skipPermissions: boolean): string {
    const flag = skipPermissions ? ' --dangerously-skip-permissions' : ''
    if (profile === null) {
        return `exec claude${flag}`
    }
    if (!isValidProfileName(profile)) {
        throw new Error(`invalid CCM Profile name: ${JSON.stringify(profile)}`)
    }
    return `exec ccm run ${shQuote(profile)} -- claude${flag}`
}

/** wsl.exe arguments. Interactive login bash, so the ccm shim and ~/.local/bin are on PATH. */
export function wslArgs (profile: string | null, opts: LaunchOptions): string[] {
    const folder = (opts.folder || '~').trim() || '~'
    return ['-d', opts.distro, '--cd', folder, '-e', 'bash', '-lic', claudeCommand(profile, opts.skipPermissions)]
}
