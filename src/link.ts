// Link layer: reliable, ordered bytes between two peers over a shared half-duplex AudioLink.
//
// Frame (inside the modem payload):
//   [0xA0 | type][flags][conn u16][seq][ack][ackBits][data...]
//   type: 0 DATA (empty data = pure ack), 1 SYN, 2 SYN-ACK, 3 FIN, 4 RST
//   flags: bit0 role (0 dialer, 1 listener; a side ignores frames with its own role, i.e. its own echo), bit1 OVER
//   SYN / SYN-ACK data: [to tag 4][from tag 4][optional payload]; a tag is the last 4 bytes of the PeerId multihash.
//   The payload lets a handshake ride in the SYN and SYN-ACK instead of costing two more frames.
//
// Selective repeat: `ack` is the next seq the sender expects, `ackBits` marks ack+1..ack+8 as received.
// A burst is up to `window` frames; the last one carries OVER, which hands the peer the turn. The peer
// answers with its own burst (at least a pure ack). Nobody talks when nobody has anything to say, so an
// idle connection is silent: no keepalives on a 10 B/s channel.

import { MAX_PAYLOAD } from './modem.ts'
import type { AudioLink } from './protocol.ts'

const MAGIC = 0xa0
const HEADER = 7
const TAG = 4
const DATA = 0; const SYN = 1; const SYNACK = 2; const FIN = 3; const RST = 4

export interface LinkInit {
  /** Data bytes per frame. Default: whatever fills a modem frame. */
  segment?: number
  /** Frames per burst, at most 8. Default 4. */
  window?: number
  /**
   * Seconds one max-length frame takes plus a turnaround guard. Default 22 (voice preset, 40 ms symbols).
   * A side waits `window` of these for a burst to finish or a reply to start before it resends.
   */
  rto?: number
  /** Unanswered bursts before the connection is dropped. Default 5. */
  retries?: number
  /** Connections one link will hold at once; further SYNs are ignored. Default 16. */
  maxConns?: number
  /** Seconds to wait after a write before sending, so several small writes share one frame. Default 0.02. */
  holdoff?: number
}

interface Frame { type: number, role: number, over: boolean, conn: number, seq: number, ack: number, bits: number, data: Uint8Array }

export const isLinkFrame = (f: Uint8Array): boolean => (f[0] & 0xf0) === MAGIC && f.length >= HEADER

function parse (f: Uint8Array): Frame | undefined {
  if (!isLinkFrame(f) || (f[0] & 0x0f) > RST) return undefined
  return { type: f[0] & 0x0f, role: f[1] & 1, over: (f[1] & 2) !== 0, conn: (f[2] << 8) | f[3], seq: f[4], ack: f[5], bits: f[6], data: f.subarray(HEADER) }
}

function build (fr: Frame): Uint8Array {
  const out = new Uint8Array(HEADER + fr.data.length)
  out.set([MAGIC | fr.type, fr.role | (fr.over ? 2 : 0), fr.conn >> 8, fr.conn & 0xff, fr.seq, fr.ack, fr.bits])
  out.set(fr.data, HEADER)
  return out
}

/** Has `seq` been acknowledged by (ack, bits)? */
function acked (seq: number, ack: number, bits: number): boolean {
  const below = (ack - seq) & 0xff
  if (below >= 1 && below <= 64) return true
  const above = (seq - ack) & 0xff
  return above >= 1 && above <= 8 && ((bits >> (above - 1)) & 1) === 1
}

export class LinkTimeoutError extends Error { name = 'LinkTimeoutError' }

/** One reliable byte pipe. `onData` gets in-order bytes; `onClose` fires once, with an error for resets and timeouts. */
export class LinkConn {
  onClose: (err?: Error) => void = () => {}
  onDrain: () => void = () => {}
  private dataCb?: (bytes: Uint8Array) => void
  private readonly early: Uint8Array[] = [] // delivered before onData was set
  private queue: Uint8Array[] = [] // bytes waiting to be cut into segments
  private finQueued = false
  private readonly inflight = new Map<number, { type: number, data: Uint8Array }>()
  private nextSeq = 0
  private expect = 0
  private readonly ooo = new Map<number, Frame>()
  private owe = false // received data since we last acked
  private turn: 'free' | 'theirs' = 'free'
  private timer?: ReturnType<typeof setTimeout>
  private retries = 0
  private sending = false
  private closed = false
  private needsDrain = false
  private fin?: () => void
  private synack?: (payload: Uint8Array) => void
  private lastSynAck = 0
  private synAckPayload: Uint8Array = new Uint8Array(0)

  private readonly link: Link
  readonly id: number
  readonly role: 0 | 1
  readonly peerTag: Uint8Array

  constructor (link: Link, id: number, role: 0 | 1, peerTag: Uint8Array) {
    this.link = link; this.id = id; this.role = role; this.peerTag = peerTag
  }

  /** In-order bytes from the peer. Anything heard before this is set is delivered when it is. */
  set onData (cb: (bytes: Uint8Array) => void) {
    this.dataCb = cb
    for (const b of this.early.splice(0)) cb(b)
  }

  /** Bytes queued or in flight. */
  get pending (): number {
    let n = 0
    for (const b of this.queue) n += b.length
    for (const s of this.inflight.values()) n += s.data.length
    return n
  }

  /** Queue bytes; returns false when the caller should wait for `onDrain`. */
  write (bytes: Uint8Array): boolean {
    if (this.closed || this.finQueued) throw new Error('link connection closed')
    this.queue.push(bytes)
    this.kick()
    if (this.pending > 4 * this.link.opts.segment) this.needsDrain = true
    return !this.needsDrain
  }

  /** Send everything queued, then FIN; resolves once the peer acked it all (or gave up answering). */
  async close (): Promise<void> {
    if (this.closed) return
    await new Promise<void>(resolve => {
      this.fin = resolve
      this.finQueued = true
      this.kick()
    })
    this.teardown()
  }

  private get hasQueued (): boolean { return this.queue.length > 0 || (this.finQueued && !this.finSent) }
  private finSent = false

  /** Tell the peer to drop the connection now. */
  reset (): void {
    if (this.closed) return
    void this.link.send(this.frame(RST, 0, new Uint8Array(0), true))
    this.teardown(new Error('reset'))
  }

  private tags (): Uint8Array {
    const t = new Uint8Array(2 * TAG)
    t.set(this.peerTag); t.set(this.link.tag, TAG)
    return t
  }

  /** @internal dialer side: SYN (with `payload`) until a SYN-ACK; resolves with the SYN-ACK's payload */
  async connect (signal?: AbortSignal, payload = new Uint8Array(0)): Promise<Uint8Array> {
    const syn = new Uint8Array(2 * TAG + payload.length)
    syn.set(this.tags()); syn.set(payload, 2 * TAG)
    for (let i = 0; i <= this.link.opts.retries; i++) {
      signal?.throwIfAborted()
      let timer: ReturnType<typeof setTimeout> | undefined
      const got = new Promise<Uint8Array | undefined>(resolve => {
        this.synack = resolve
        timer = setTimeout(() => resolve(undefined), this.link.opts.rto * 1000)
      })
      await this.link.send(this.frame(SYN, 0, syn, true))
      const reply = await got
      clearTimeout(timer)
      if (reply != null) return reply
    }
    this.teardown()
    throw new LinkTimeoutError('no answer to SYN')
  }

  /** @internal the listener drops a half-open connection nobody finishes */
  expire (err: Error): void { this.teardown(err) }

  /** @internal listener side; at most one per rto, so a looping SYN can't fill the speaker queue */
  sendSynAck (payload?: Uint8Array): void {
    if (payload != null) this.synAckPayload = payload
    if (Date.now() - this.lastSynAck < this.link.opts.rto * 1000) return
    this.lastSynAck = Date.now()
    const data = new Uint8Array(2 * TAG + this.synAckPayload.length)
    data.set(this.tags()); data.set(this.synAckPayload, 2 * TAG)
    void this.link.send(this.frame(SYNACK, 0, data, true))
  }

  /** @internal */
  receive (fr: Frame): void {
    if (fr.role === this.role || this.closed) return
    this.clearTimer()
    this.retries = 0
    if (fr.type === RST) { this.teardown(new Error('reset by peer')); return }
    if (fr.type === SYNACK && fr.data.length >= 2 * TAG) this.synack?.(fr.data.slice(2 * TAG))
    for (const s of this.inflight.keys()) if (acked(s, fr.ack, fr.bits)) this.inflight.delete(s)
    this.maybeDrain()
    // closing: done once everything up to and including the FIN is acked
    if (this.fin != null && this.finSent && this.inflight.size === 0) this.fin()
    if (fr.type === FIN || (fr.type === DATA && fr.data.length > 0)) {
      this.owe = true
      const d = (fr.seq - this.expect) & 0xff
      if (d === 0) {
        this.deliver(fr)
        this.expect = (this.expect + 1) & 0xff
        for (let next = this.ooo.get(this.expect); next != null; next = this.ooo.get(this.expect)) {
          this.ooo.delete(this.expect)
          this.deliver(next)
          this.expect = (this.expect + 1) & 0xff
        }
      } else if (d <= 8) {
        this.ooo.set(fr.seq, fr)
      }
    }
    this.turn = fr.over ? 'free' : 'theirs'
    if (!fr.over) this.armTimer()
    this.kick()
  }

  private deliver (fr: Frame): void {
    if (fr.type === FIN) { this.remoteClosed = true; return }
    if (this.dataCb == null) this.early.push(fr.data.slice()); else this.dataCb(fr.data.slice())
  }

  private remoteClosed = false

  private kick (): void {
    if (this.sending || this.closed || this.turn !== 'free') return
    if (this.owe || this.inflight.size > 0 || this.hasQueued) {
      // wait a moment so a burst carries everything the app is about to write
      this.sending = true
      setTimeout(() => { void this.burst() }, this.link.opts.holdoff * 1000)
    } else if (this.remoteClosed) this.teardown()
  }

  /** Cut the next segment off the byte queue, or the FIN once the bytes are gone. */
  private nextSegment (): { type: number, data: Uint8Array } | undefined {
    const { segment } = this.link.opts
    if (this.queue.length > 0) {
      const all = this.queue.length === 1 ? this.queue[0] : Uint8Array.from(this.queue.flatMap(b => [...b]))
      this.queue = all.length > segment ? [all.subarray(segment)] : []
      return { type: DATA, data: all.slice(0, segment) }
    }
    if (this.finQueued && !this.finSent) { this.finSent = true; return { type: FIN, data: new Uint8Array(0) } }
    return undefined
  }

  private maybeDrain (): void {
    if (this.needsDrain && this.pending <= 2 * this.link.opts.segment) { this.needsDrain = false; this.onDrain() }
  }

  private async burst (): Promise<void> {
    if (this.closed) return
    if (this.turn !== 'free') { this.sending = false; return } // the peer started talking during the holdoff
    this.sending = true
    const { window } = this.link.opts
    const seqs = [...this.inflight.keys()]
    for (let next = this.inflight.size < window ? this.nextSegment() : undefined; next != null; next = this.inflight.size < window ? this.nextSegment() : undefined) {
      const s = this.nextSeq
      this.nextSeq = (s + 1) & 0xff
      this.inflight.set(s, next)
      seqs.push(s)
    }
    const frames = seqs.length > 0 ? seqs.map(s => ({ ...this.inflight.get(s)!, seq: s })) : [{ type: DATA, data: new Uint8Array(0), seq: 0 }]
    this.owe = false
    this.turn = this.inflight.size > 0 ? 'theirs' : 'free'
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]
      await this.link.send(this.frame(f.type, f.seq, f.data, i === frames.length - 1))
      if (this.closed) return
    }
    this.sending = false
    if (this.turn === 'theirs' && this.inflight.size > 0) this.armTimer()
    this.maybeDrain()
    this.kick()
  }

  private frame (type: number, seq: number, data: Uint8Array, over: boolean): Uint8Array {
    let bits = 0
    for (let i = 1; i <= 8; i++) if (this.ooo.has((this.expect + i) & 0xff)) bits |= 1 << (i - 1)
    return build({ type, role: this.role, over, conn: this.id, seq, ack: this.expect, bits, data })
  }

  private armTimer (): void {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (++this.retries > this.link.opts.retries) {
        // a FIN nobody answers still means we're done
        if ([...this.inflight.values()].every(s => s.type === FIN)) { this.fin?.(); return }
        this.teardown(new LinkTimeoutError('peer stopped answering'))
        return
      }
      this.turn = 'free'
      this.kick()
    }, this.link.opts.rto * this.link.opts.window * 1000 * (1 + 0.5 * Math.random()))
  }

  private clearTimer (): void {
    if (this.timer != null) clearTimeout(this.timer)
    this.timer = undefined
  }

  private teardown (err?: Error): void {
    if (this.closed) return
    this.closed = true
    this.clearTimer()
    this.link.drop(this.id)
    this.fin?.() // a close() in progress is over too, however it ended
    this.onClose(err)
  }
}

/** All link connections sharing one AudioLink (one room). */
export class Link {
  readonly opts: Required<LinkInit>
  private readonly conns = new Map<number, LinkConn>()
  private accept?: (conn: LinkConn, synPayload: Uint8Array) => Promise<Uint8Array | undefined> | void

  readonly audio: AudioLink
  readonly tag: Uint8Array

  constructor (audio: AudioLink, tag: Uint8Array, init: LinkInit = {}) {
    this.audio = audio; this.tag = tag
    const maxFrame = Math.min(audio.maxFrame ?? MAX_PAYLOAD, MAX_PAYLOAD)
    this.opts = { segment: maxFrame - HEADER, window: 4, rto: 22, retries: 5, holdoff: 0.02, maxConns: 16, ...init }
    if (this.opts.window > 8 || this.opts.segment + HEADER > maxFrame) throw new RangeError('window <= 8, segment must fit a frame')
    // frames are handled on a microtask so a reply never runs inside the sender's send()
    audio.onFrame(f => { const fr = parse(f); if (fr != null) queueMicrotask(() => { this.receive(fr) }) })
  }

  /** Accept incoming connections addressed to our tag. The callback gets the SYN payload and may return the SYN-ACK payload. */
  listen (cb?: (conn: LinkConn, synPayload: Uint8Array) => Promise<Uint8Array | undefined> | void): void { this.accept = cb }

  /** Open a connection; `payload` rides in the SYN, the SYN-ACK's payload comes back with the connection. */
  async dial (peerTag: Uint8Array, signal?: AbortSignal, payload?: Uint8Array): Promise<{ conn: LinkConn, reply: Uint8Array }> {
    let id: number
    do id = Math.floor(Math.random() * 0x10000); while (this.conns.has(id))
    const conn = new LinkConn(this, id, 0, peerTag)
    this.conns.set(id, conn)
    try { return { conn, reply: await conn.connect(signal, payload) } } catch (err) { conn.reset(); throw err }
  }

  /** @internal */
  send (frame: Uint8Array): Promise<void> { return this.audio.send(frame) }

  /** @internal */
  drop (id: number): void { this.conns.delete(id) }

  private receive (fr: Frame): void {
    if (fr.type === SYN) {
      if (fr.data.length < 2 * TAG || !fr.data.subarray(0, TAG).every((v, i) => v === this.tag[i]) || this.accept == null) return
      const from = fr.data.slice(TAG, 2 * TAG)
      const existing = this.conns.get(fr.conn)
      if (existing != null) {
        // SYN-ACK was lost: say it again. A different dialer picking the same id is ignored.
        if (existing.role === 1 && existing.peerTag.every((v, i) => v === from[i])) existing.sendSynAck()
        return
      }
      // anyone can SYN (link frames are unsigned): bound what an injector can make us hold and play
      if (this.conns.size >= this.opts.maxConns) return
      const conn = new LinkConn(this, fr.conn, 1, from)
      this.conns.set(fr.conn, conn)
      // the SYN-ACK waits for the acceptor's reply payload (a handshake answer), if it gives one
      Promise.resolve(this.accept(conn, fr.data.slice(2 * TAG))).then(reply => { conn.sendSynAck(reply ?? new Uint8Array(0)) }, () => {})
      return
    }
    this.conns.get(fr.conn)?.receive(fr)
  }
}
