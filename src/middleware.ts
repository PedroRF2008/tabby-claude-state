import { Observable, Subject } from 'rxjs'
import { SessionMiddleware } from 'tabby-terminal'

export type ClaudeState = 'working' | 'waiting' | 'done' | 'error' | 'idle'
export const STATES: ClaudeState[] = ['working', 'waiting', 'done', 'error', 'idle']

export interface ClaudeStateEvent {
    state: ClaudeState
    /** Short human-readable context (permission request, question, final reply…) */
    message: string
    /** Project (directory) name of the Claude session */
    project: string
}

const PREFIX = Buffer.from('\x1b]1337;SetUserVar=CLAUDE_')
const MAX_BODY = 2048        // NAME=base64(≤ ~200 chars of UTF-8)
const FLUSH_MS = 50          // don't hold back a partial match for long

/**
 * Sits at the front of the session middleware stack (ahead of Tabby's own
 * OSCProcessor, which would otherwise swallow OSC 1337), strips our
 * `SetUserVar=CLAUDE_*` sequences out of the stream and reports state changes.
 * CLAUDE_PROJECT / CLAUDE_MSG are context; CLAUDE_STATE commits an event.
 * All other bytes pass through untouched.
 */
export class ClaudeStateMiddleware extends SessionMiddleware {
    get state$ (): Observable<ClaudeStateEvent> { return this.state }

    private state = new Subject<ClaudeStateEvent>()
    private pending: Buffer | null = null
    private flushTimer: ReturnType<typeof setTimeout> | null = null
    private vars: Record<string, string> = {}

    feedFromSession (data: Buffer): void {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer)
            this.flushTimer = null
        }
        if (this.pending) {
            data = Buffer.concat([this.pending, data])
            this.pending = null
        }

        const out: Buffer[] = []
        let pos = 0

        while (pos < data.length) {
            const start = data.indexOf(PREFIX, pos)

            if (start === -1) {
                // Keep a possible partial prefix at the very end for the next chunk.
                const keep = partialPrefixAtEnd(data, pos)
                out.push(data.subarray(pos, data.length - keep))
                if (keep) {
                    this.pending = data.subarray(data.length - keep)
                }
                break
            }

            out.push(data.subarray(pos, start))
            const bodyStart = start + PREFIX.length
            const term = findTerminator(data, bodyStart)

            if (term === 'malformed') {
                out.push(data.subarray(start, bodyStart))
                pos = bodyStart
                continue
            }

            if (term === null) {
                // Sequence split across chunks; wait for the rest.
                this.pending = data.subarray(start)
                break
            }

            this.handleVar(data.subarray(bodyStart, term.index).toString('latin1'))
            pos = term.index + term.length
        }

        const passthrough = out.filter(b => b.length)
        if (passthrough.length) {
            super.feedFromSession(passthrough.length === 1 ? passthrough[0] : Buffer.concat(passthrough))
        }

        if (this.pending) {
            this.flushTimer = setTimeout(() => {
                this.flushTimer = null
                const p = this.pending
                this.pending = null
                if (p) {
                    super.feedFromSession(p)
                }
            }, FLUSH_MS)
        }
    }

    close (): void {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer)
        }
        this.state.complete()
        super.close()
    }

    /** body = "<NAME-SUFFIX>=<base64>", e.g. "STATE=d29ya2luZw==" */
    private handleVar (body: string): void {
        const eq = body.indexOf('=')
        if (eq <= 0) {
            return
        }
        const name = body.substring(0, eq)
        let value: string
        try {
            value = Buffer.from(body.substring(eq + 1).trim(), 'base64').toString('utf8').trim()
        } catch {
            return
        }

        if (name !== 'STATE') {
            this.vars[name] = value
            return
        }
        if ((STATES as string[]).includes(value)) {
            this.state.next({
                state: value as ClaudeState,
                message: this.vars.MSG ?? '',
                project: this.vars.PROJECT ?? '',
            })
        }
        this.vars = {}
    }
}

/**
 * Finds BEL or ST (ESC \) after the body.
 * null = not in this buffer yet; 'malformed' = definitely not our sequence.
 */
function findTerminator (data: Buffer, from: number): { index: number, length: number } | null | 'malformed' {
    const limit = Math.min(data.length, from + MAX_BODY)
    for (let i = from; i < limit; i++) {
        const c = data[i]
        if (c === 0x07) {
            return { index: i, length: 1 }
        }
        if (c === 0x1b) {
            if (i + 1 >= data.length) {
                return null   // need next chunk to see if it's ESC \
            }
            return data[i + 1] === 0x5c ? { index: i, length: 2 } : 'malformed'
        }
        if (c < 0x20) {
            return 'malformed'  // control chars never appear in NAME=base64
        }
    }
    return limit < from + MAX_BODY ? null : 'malformed'
}

/** Length of the longest suffix of data[from..] that is a proper prefix of PREFIX. */
function partialPrefixAtEnd (data: Buffer, from: number): number {
    const max = Math.min(PREFIX.length - 1, data.length - from)
    for (let k = max; k > 0; k--) {
        if (data[data.length - k] !== 0x1b) {
            continue
        }
        if (data.subarray(data.length - k).equals(PREFIX.subarray(0, k))) {
            return k
        }
    }
    return 0
}
