import { Observable, Subject } from 'rxjs'
import { SessionMiddleware } from 'tabby-terminal'

export type ClaudeState = 'working' | 'waiting' | 'done' | 'error' | 'idle'
const STATES: ClaudeState[] = ['working', 'waiting', 'done', 'error', 'idle']

const PREFIX = Buffer.from('\x1b]1337;SetUserVar=CLAUDE_STATE=')
const MAX_BODY = 64          // base64 of the longest state is tiny
const FLUSH_MS = 50          // don't hold back a partial match for long

/**
 * Sits at the front of the session middleware stack (ahead of Tabby's own
 * OSCProcessor, which would otherwise swallow OSC 1337), strips our
 * SetUserVar sequence out of the stream and reports the decoded state.
 * All other bytes pass through untouched.
 */
export class ClaudeStateMiddleware extends SessionMiddleware {
    get state$ (): Observable<ClaudeState> { return this.state }

    private state = new Subject<ClaudeState>()
    private pending: Buffer | null = null
    private flushTimer: ReturnType<typeof setTimeout> | null = null

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
                if (data.length - bodyStart < MAX_BODY) {
                    // Sequence split across chunks; wait for the rest.
                    this.pending = data.subarray(start)
                } else {
                    // Malformed: pass it through untouched.
                    out.push(data.subarray(start))
                }
                break
            }

            this.emit(data.subarray(bodyStart, term.index).toString('latin1'))
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

    private emit (b64: string): void {
        let value = ''
        try {
            value = Buffer.from(b64.trim(), 'base64').toString('utf8').trim()
        } catch {
            return
        }
        if ((STATES as string[]).includes(value)) {
            this.state.next(value as ClaudeState)
        }
    }
}

/**
 * Finds BEL or ST (ESC \) after the body.
 * null = not in this buffer yet; 'malformed' = definitely not our sequence.
 */
function findTerminator (data: Buffer, from: number): { index: number, length: number } | null | 'malformed' {
    const limit = Math.min(data.length, from + MAX_BODY)
    for (let i = from; i < limit; i++) {
        if (data[i] === 0x07) {
            return { index: i, length: 1 }
        }
        if (data[i] === 0x1b) {
            if (i + 1 >= data.length) {
                return null   // need next chunk to see if it's ESC \
            }
            return data[i + 1] === 0x5c ? { index: i, length: 2 } : 'malformed'
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
