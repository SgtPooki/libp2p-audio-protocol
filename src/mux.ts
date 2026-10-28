// audiomux: a stream muxer with a 1-byte header and pre-negotiated protocols, for links where
// every byte costs 80 ms. yamux spends 12 bytes per frame plus a multistream-select round trip
// per stream; this spends 3 bytes per record and names the protocol in the OPEN record.
//
// Record: [id << 3 | type][len u16][payload]
//   type 0 OPEN   payload: index into the shared protocol table, or 0xff + the protocol name
//   type 1 DATA
//   type 2 CLOSE_WRITE (half-close, no payload)
//   type 3 RESET
// The outbound side of the connection opens even ids, the inbound side odd ones; 32 ids, reused after close.

import { AbstractStream, AbstractStreamMuxer } from '@libp2p/utils'
import { Uint8ArrayList } from 'uint8arraylist'
import type { AbortOptions, CreateStreamOptions, MessageStream, MessageStreamDirection, StreamMuxerFactory } from '@libp2p/interface'
import type { AbstractStreamInit, SendResult } from '@libp2p/utils'

const OPEN = 0; const DATA = 1; const CLOSE_WRITE = 2; const RESET = 3
const MAX_RECORD = 0xffff

/** Protocols both sides agree on ahead of time; index = 1 byte on air. Unknown ones travel by name. */
export const DEFAULT_PROTOCOLS = ['/ipfs/ping/1.0.0', '/echo/1.0.0', '/chat/1.0.0']

function record (id: number, type: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const out = new Uint8Array(3 + payload.length)
  out[0] = (id << 3) | type
  out[1] = payload.length >> 8; out[2] = payload.length & 0xff
  out.set(payload, 3)
  return out
}

class MuxStream extends AbstractStream {
  private readonly out: (type: number, payload?: Uint8Array) => boolean

  constructor (init: AbstractStreamInit & { out: (type: number, payload?: Uint8Array) => boolean }) {
    super({ ...init, maxMessageSize: MAX_RECORD })
    this.out = init.out
  }

  sendData (data: Uint8ArrayList): SendResult {
    return { sentBytes: data.byteLength, canSendMore: this.out(DATA, data.subarray()) }
  }

  sendReset (): void { this.out(RESET) }
  async sendCloseWrite (options?: AbortOptions): Promise<void> { this.out(CLOSE_WRITE); options?.signal?.throwIfAborted() }
  async sendCloseRead (): Promise<void> {}
  sendPause (): void {}
  sendResume (): void {}
}

class Mux extends AbstractStreamMuxer<MuxStream> {
  private readonly buf = new Uint8ArrayList()
  private readonly protocols: string[]
  private nextId: number

  constructor (maConn: MessageStream, protocols: string[]) {
    super(maConn, { protocol: '/audiomux/1.0.0', name: 'audiomux' })
    this.protocols = protocols
    this.nextId = maConn.direction === 'outbound' ? 0 : 1
  }

  onData (data: Uint8Array | Uint8ArrayList): void {
    this.buf.append(data)
    while (this.buf.byteLength >= 3) {
      const len = (this.buf.get(1) << 8) | this.buf.get(2)
      if (this.buf.byteLength < 3 + len) return
      const hdr = this.buf.get(0)
      const payload = this.buf.subarray(3, 3 + len)
      this.buf.consume(3 + len)
      this.onRecord(hdr >> 3, hdr & 7, payload)
    }
  }

  private onRecord (id: number, type: number, payload: Uint8Array): void {
    const stream = this.streams.find(s => s.id === String(id))
    if (type === OPEN) {
      if (stream != null) return // already open: a duplicate, ignore
      const protocol = payload[0] === 0xff ? new TextDecoder().decode(payload.subarray(1)) : this.protocols[payload[0]] ?? ''
      this.onRemoteStream(this.create(id, 'inbound', protocol))
    } else if (stream == null) {
      // data for a stream we closed; nothing to do
    } else if (type === DATA) stream.onData(payload)
    else if (type === CLOSE_WRITE) stream.onRemoteCloseWrite()
    else if (type === RESET) stream.onRemoteReset()
  }

  onCreateStream (options: CreateStreamOptions): MuxStream {
    const used = new Set(this.streams.map(s => Number(s.id)))
    let id = this.nextId
    for (let tries = 0; used.has(id); tries++) {
      if (tries >= 16) throw new Error('audiomux: all 16 outbound stream ids in use')
      id = (id + 2) & 31
    }
    this.nextId = (id + 2) & 31
    const protocol = options.protocol ?? ''
    const stream = this.create(id, 'outbound', protocol)
    const index = this.protocols.indexOf(protocol)
    this.send(record(id, OPEN, index >= 0 ? Uint8Array.of(index) : Uint8Array.of(0xff, ...new TextEncoder().encode(protocol))))
    return stream
  }

  private create (id: number, direction: MessageStreamDirection, protocol: string): MuxStream {
    return new MuxStream({
      ...this.streamOptions,
      id: String(id),
      direction,
      protocol,
      log: this.log.newScope(`stream:${direction}:${id}`),
      out: (type, payload) => this.send(record(id, type, payload))
    })
  }
}

export function audiomux (protocols: string[] = DEFAULT_PROTOCOLS): StreamMuxerFactory {
  return { protocol: '/audiomux/1.0.0', createStreamMuxer: maConn => new Mux(maConn, protocols) }
}
