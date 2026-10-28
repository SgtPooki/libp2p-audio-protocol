// js-libp2p transport over sound: /audio/<preset>/p2p/<PeerId>.
//
// A `Link` (src/link.ts) turns the shared room into reliable byte pipes; each pipe is a
// libp2p MultiaddrConnection handed to the stock upgrader (Noise + a muxer), so the result is a
// normal Connection with streams and protocol handlers. Run yamux with keepalives off: a ping is
// two frames, about 5 s of airtime, every 30 s.

import { transportSymbol, TypedEventEmitter } from '@libp2p/interface'
import { peerIdFromString } from '@libp2p/peer-id'
import { AbstractMultiaddrConnection } from '@libp2p/utils'
import { CODE_P2P, registry, V } from '@multiformats/multiaddr'
import { Link, type LinkConn, type LinkInit } from './link.ts'
import type { AudioLink } from './protocol.ts'
import type { AbortOptions, ComponentLogger, Connection, CreateListenerOptions, DialTransportOptions, Listener, ListenerEvents, Logger, MessageStreamDirection, PeerId, Transport } from '@libp2p/interface'
import type { SendResult } from '@libp2p/utils'
import type { Multiaddr } from '@multiformats/multiaddr'
import type { Uint8ArrayList } from 'uint8arraylist'

/** Multiaddr protocol `audio`. Private-use code until it is registered in the multicodec table. */
export const CODE_AUDIO = 0x300003
try { registry.getProtocol(CODE_AUDIO) } catch { registry.addProtocol({ code: CODE_AUDIO, name: 'audio', size: V }) }

const peerOf = (ma: Multiaddr): string | undefined => ma.getComponents().findLast(c => c.code === CODE_P2P)?.value

/** The last 4 bytes of a PeerId: how link frames address a peer in the room. */
export const tagOf = (id: PeerId): Uint8Array => id.toMultihash().bytes.slice(-4)

class AudioMaConn extends AbstractMultiaddrConnection {
  private readonly conn: LinkConn

  constructor (conn: LinkConn, remoteAddr: Multiaddr, direction: MessageStreamDirection, log: Logger) {
    super({ remoteAddr, direction, log, inactivityTimeout: 0 })
    this.conn = conn
    conn.onData = b => { this.onData(b) }
    conn.onDrain = () => { this.safeDispatchEvent('drain') }
    conn.onClose = err => { err != null ? this.abort(err) : this.onTransportClosed() }
  }

  sendData (data: Uint8ArrayList): SendResult {
    return { sentBytes: data.byteLength, canSendMore: this.conn.write(data.subarray()) }
  }

  async sendClose (options?: AbortOptions): Promise<void> {
    options?.signal?.throwIfAborted()
    await this.conn.close()
  }

  sendReset (): void { this.conn.reset() }
  sendPause (): void {}
  sendResume (): void {}
}

export interface AudioTransportInit extends LinkInit {
  /** Which `/audio/<preset>` addresses this transport serves. Must match the link's modem preset. Default `voice`. */
  preset?: string
}

export interface AudioTransportComponents { peerId: PeerId, logger: ComponentLogger }

class AudioTransport implements Transport {
  readonly [transportSymbol] = true
  readonly [Symbol.toStringTag] = '@libp2p/audio'
  private readonly link: Link
  private readonly preset: string
  private readonly log: Logger

  constructor (components: AudioTransportComponents, audio: AudioLink, init: AudioTransportInit = {}) {
    const { preset = 'voice', ...linkInit } = init
    this.preset = preset
    this.log = components.logger.forComponent('libp2p:audio')
    this.link = new Link(audio, tagOf(components.peerId), linkInit)
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
    const maConn = new AudioMaConn(conn, ma, 'outbound', this.log)
    return options.upgrader.upgradeOutbound(maConn, { signal: options.signal })
  }

  createListener (options: CreateListenerOptions): Listener {
    const { link, log } = this
    let addr: Multiaddr | undefined
    const listener = new (class extends TypedEventEmitter<ListenerEvents> implements Listener {
      async listen (ma: Multiaddr): Promise<void> {
        addr = ma
        link.listen(conn => {
          const maConn = new AudioMaConn(conn, ma, 'inbound', log)
          options.upgrader.upgradeInbound(maConn, { signal: AbortSignal.timeout(600_000) }).catch(err => { log.error('inbound upgrade failed - %e', err) })
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
