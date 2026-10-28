// js-libp2p transport over sound: /audio/<preset>/p2p/<PeerId>.
//
// A `Link` (src/link.ts) turns the shared room into reliable byte pipes; each pipe is a
// libp2p MultiaddrConnection, so the result is a normal Connection with streams and protocol
// handlers. Two ways to secure it:
//   handshake: 'noise'  the stock upgrader: multistream + Noise XX + yamux (keepalive off). ~1 KB on air.
//   handshake: 'lean'   the transport's own signed handshake (src/handshake.ts) and 1-byte-header
//                       muxer (src/mux.ts); `encrypt: false` is the sign-only mode for ham bands. ~300 B.

import { transportSymbol, TypedEventEmitter } from '@libp2p/interface'
import { peerIdFromString } from '@libp2p/peer-id'
import { AbstractMultiaddrConnection } from '@libp2p/utils'
import { CODE_P2P, registry, V } from '@multiformats/multiaddr'
import { initiate, respond, MSG1, MSG2, type Session } from './handshake.ts'
import { Link, type LinkConn, type LinkInit } from './link.ts'
import { audiomux } from './mux.ts'
import type { AudioLink } from './protocol.ts'
import type { AbortOptions, ComponentLogger, Connection, CreateListenerOptions, DialTransportOptions, Listener, ListenerEvents, Logger, MessageStreamDirection, PeerId, PrivateKey, StreamMuxerFactory, Transport } from '@libp2p/interface'
import type { SendResult } from '@libp2p/utils'
import type { Multiaddr } from '@multiformats/multiaddr'
import type { Uint8ArrayList } from 'uint8arraylist'

/** Multiaddr protocol `audio`. Private-use code until it is registered in the multicodec table. */
export const CODE_AUDIO = 0x300003
try { registry.getProtocol(CODE_AUDIO) } catch { registry.addProtocol({ code: CODE_AUDIO, name: 'audio', size: V }) }

const peerOf = (ma: Multiaddr): string | undefined => ma.getComponents().findLast(c => c.code === CODE_P2P)?.value

/** The last 4 bytes of a PeerId: how link frames address a peer in the room. */
export const tagOf = (id: PeerId): Uint8Array => id.toMultihash().bytes.slice(-4)

/** Reads the fixed-size handshake messages off a link pipe; whatever follows goes to the MultiaddrConnection. */
function reader (conn: LinkConn): { take: (n: number, signal?: AbortSignal) => Promise<Uint8Array>, rest: () => Uint8Array[] } {
  const chunks: Uint8Array[] = []
  let waiting: { n: number, resolve: (b: Uint8Array) => void } | undefined
  const check = (): void => {
    if (waiting == null) return
    const have = chunks.reduce((n, c) => n + c.length, 0)
    if (have < waiting.n) return
    const all = new Uint8Array(have)
    let at = 0
    for (const c of chunks) { all.set(c, at); at += c.length }
    chunks.length = 0
    if (have > waiting.n) chunks.push(all.subarray(waiting.n))
    const { resolve, n } = waiting
    waiting = undefined
    resolve(all.slice(0, n))
  }
  conn.onData = b => { chunks.push(b); check() }
  return {
    take: async (n, signal) => await new Promise((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      waiting = { n, resolve }
      check()
    }),
    rest: () => chunks.splice(0)
  }
}

class AudioMaConn extends AbstractMultiaddrConnection {
  private readonly conn: LinkConn
  private readonly session?: Session

  constructor (conn: LinkConn, remoteAddr: Multiaddr, direction: MessageStreamDirection, log: Logger, session?: Session, early: Uint8Array[] = []) {
    super({ remoteAddr, direction, log, inactivityTimeout: 0 })
    this.conn = conn
    this.session = session
    const receive = (b: Uint8Array): void => {
      if (session == null) { this.onData(b); return }
      try { for (const plain of session.open(b)) this.onData(plain) } catch (err: any) { this.abort(err) }
    }
    for (const b of early) receive(b)
    conn.onData = receive
    conn.onDrain = () => { this.safeDispatchEvent('drain') }
    conn.onClose = err => { err != null ? this.abort(err) : this.onTransportClosed() }
  }

  sendData (data: Uint8ArrayList): SendResult {
    const bytes = data.subarray()
    return { sentBytes: data.byteLength, canSendMore: this.conn.write(this.session == null ? bytes : this.session.seal(bytes)) }
  }

  async sendClose (options?: AbortOptions): Promise<void> {
    options?.signal?.throwIfAborted()
    await this.conn.close()
  }

  sendReset (): void { this.conn.reset() }
  sendPause (): void {}
  sendResume (): void {}
}

/**
 * libp2p's defaults assume a network, not a 10 B/s channel: a dial times out after 10 s, an inbound
 * upgrade after 10 s, a close after 1 s, and the connection monitor pings every 10 s and drops the
 * connection when a ping takes over 5 s. Spread this into `createLibp2p({ ...AUDIO_DEFAULTS })`.
 */
export const AUDIO_DEFAULTS = {
  connectionManager: {
    dialTimeout: 600_000,
    addressDialTimeout: 600_000,
    inboundUpgradeTimeout: 600_000,
    outboundStreamProtocolNegotiationTimeout: 300_000,
    inboundStreamProtocolNegotiationTimeout: 300_000,
    connectionCloseTimeout: 120_000
  },
  connectionMonitor: { enabled: false }
}

export interface AudioTransportInit extends LinkInit {
  /** Which `/audio/<preset>` addresses this transport serves. Must match the link's modem preset. Default `voice`. */
  preset?: string
  /** `noise`: the stock libp2p upgrade. `lean`: the transport's own signed handshake and muxer. Default `noise`. */
  handshake?: 'noise' | 'lean'
  /** Lean mode only. `false` is sign-only (ham mode): authenticated, not confidential. Both sides must agree. Default true. */
  encrypt?: boolean
  /** Lean mode only: protocols both sides pre-agree on, so a stream open costs 1 byte instead of a name. */
  protocols?: string[]
}

export interface AudioTransportComponents { peerId: PeerId, privateKey: PrivateKey, logger: ComponentLogger }

class AudioTransport implements Transport {
  readonly [transportSymbol] = true
  readonly [Symbol.toStringTag] = '@libp2p/audio'
  private readonly link: Link
  private readonly preset: string
  private readonly log: Logger
  private readonly key: PrivateKey
  private readonly lean?: { encrypt: boolean, mux: StreamMuxerFactory }

  constructor (components: AudioTransportComponents, audio: AudioLink, init: AudioTransportInit = {}) {
    const { preset = 'voice', handshake = 'noise', encrypt = true, protocols, ...linkInit } = init
    this.preset = preset
    this.key = components.privateKey
    this.log = components.logger.forComponent('libp2p:audio')
    this.link = new Link(audio, tagOf(components.peerId), linkInit)
    if (handshake === 'lean') this.lean = { encrypt, mux: audiomux(protocols) }
  }

  private mine (ma: Multiaddr): boolean {
    const [first] = ma.getComponents()
    return first?.name === 'audio' && first.value === this.preset
  }

  listenFilter = (mas: Multiaddr[]): Multiaddr[] => mas.filter(ma => this.mine(ma))
  dialFilter = (mas: Multiaddr[]): Multiaddr[] => mas.filter(ma => this.mine(ma) && peerOf(ma) != null)

  async dial (ma: Multiaddr, options: DialTransportOptions): Promise<Connection> {
    const peer = peerIdFromString(peerOf(ma)!)
    const conn = await this.link.dial(tagOf(peer), options.signal)
    if (this.lean == null) {
      return options.upgrader.upgradeOutbound(new AudioMaConn(conn, ma, 'outbound', this.log), { signal: options.signal })
    }
    try {
      const rx = reader(conn)
      const hs = await initiate(this.key, peer, this.lean.encrypt)
      conn.write(hs.msg1)
      const session = await hs.finish(await rx.take(MSG2, options.signal))
      const maConn = new AudioMaConn(conn, ma, 'outbound', this.log, session, rx.rest())
      return await options.upgrader.upgradeOutbound(maConn, { signal: options.signal, skipEncryption: true, remotePeer: peer, muxerFactory: this.lean.mux })
    } catch (err) {
      conn.reset()
      throw err
    }
  }

  private async accept (conn: LinkConn, ma: Multiaddr, options: CreateListenerOptions): Promise<void> {
    const signal = AbortSignal.timeout(600_000)
    if (this.lean == null) {
      await options.upgrader.upgradeInbound(new AudioMaConn(conn, ma, 'inbound', this.log), { signal })
      return
    }
    const rx = reader(conn)
    const { remotePeer, msg2, session } = await respond(this.key, await rx.take(MSG1, signal), this.lean.encrypt)
    conn.write(msg2)
    const maConn = new AudioMaConn(conn, ma.encapsulate(`/p2p/${remotePeer}`), 'inbound', this.log, session, rx.rest())
    await options.upgrader.upgradeInbound(maConn, { signal, skipEncryption: true, remotePeer, muxerFactory: this.lean.mux })
  }

  createListener (options: CreateListenerOptions): Listener {
    const { link, log } = this
    const accept = this.accept.bind(this)
    let addr: Multiaddr | undefined
    const listener = new (class extends TypedEventEmitter<ListenerEvents> implements Listener {
      async listen (ma: Multiaddr): Promise<void> {
        addr = ma
        link.listen(conn => {
          accept(conn, ma, options).catch(err => { log.error('inbound connection failed - %e', err); conn.reset() })
        })
        this.safeDispatchEvent('listening')
      }

      getAddrs (): Multiaddr[] { return addr == null ? [] : [addr] }
      updateAnnounceAddrs (): void {}
      async close (): Promise<void> { link.listen(undefined); this.safeDispatchEvent('close') }
    })()
    return listener
  }
}

export function audioTransport (audio: AudioLink, init?: AudioTransportInit): (components: AudioTransportComponents) => Transport {
  return (components) => new AudioTransport(components, audio, init)
}
