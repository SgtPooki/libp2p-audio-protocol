// libp2p over audio: every frame on air is a libp2p signed envelope (RFC 0002).
//  - a signed PeerRecord announces "I am <peerId>, reach me at <multiaddrs>" (peer discovery)
//  - a signed AudioMessage carries short text from a verifiable sender
// Listeners verify the signature, so a heard frame proves which peer sent it.

import { PeerRecord, RecordEnvelope } from '@libp2p/peer-record'
import { peerIdFromPublicKey } from '@libp2p/peer-id'
import { peerDiscoverySymbol, serviceCapabilities } from '@libp2p/interface'
import { TypedEventEmitter } from 'main-event'
import { MAX_PAYLOAD } from './modem.ts'
import type { PeerDiscovery, PeerDiscoveryEvents, PeerDiscoveryProvider, PeerId, PrivateKey, Startable } from '@libp2p/interface'
import type { Multiaddr } from '@multiformats/multiaddr'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class AudioMessage {
  static DOMAIN = 'libp2p-audio-message'
  // 0x300001 in the multicodec private-use range, varint encoded
  static CODEC = Uint8Array.of(0x81, 0x80, 0xc0, 0x01)
  readonly domain = AudioMessage.DOMAIN
  readonly codec = AudioMessage.CODEC
  readonly text: string

  constructor (text: string) { this.text = text }
  marshal (): Uint8Array { return encoder.encode(this.text) }
  equals (other: unknown): boolean { return other instanceof AudioMessage && other.text === this.text }
}

export type Frame =
  | { type: 'peer-record', from: PeerId, multiaddrs: Multiaddr[], envelope: Uint8Array }
  | { type: 'message', from: PeerId, text: string }

const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i])

async function seal (record: PeerRecord | AudioMessage, key: PrivateKey): Promise<Uint8Array> {
  const bytes = (await RecordEnvelope.seal(record, key)).marshal()
  if (bytes.length > MAX_PAYLOAD) throw new RangeError(`frame is ${bytes.length} bytes, max is ${MAX_PAYLOAD}`)
  return bytes
}

export const sealMessage = async (text: string, key: PrivateKey): Promise<Uint8Array> =>
  seal(new AudioMessage(text), key)

export const sealPeerRecord = async (key: PrivateKey, multiaddrs: Multiaddr[] = []): Promise<Uint8Array> =>
  seal(new PeerRecord({ peerId: peerIdFromPublicKey(key.publicKey), multiaddrs, seqNumber: BigInt(Date.now()) }), key)

/** Parse and verify a frame. Returns undefined for anything unknown or with a bad signature. */
export async function openFrame (bytes: Uint8Array): Promise<Frame | undefined> {
  try {
    const env = RecordEnvelope.createFromProtobuf(bytes)
    const from = peerIdFromPublicKey(env.publicKey)
    if (equal(env.payloadType, PeerRecord.CODEC) && await env.validate(PeerRecord.DOMAIN)) {
      const record = PeerRecord.createFromProtobuf(env.payload)
      if (!record.peerId.equals(from)) return undefined
      return { type: 'peer-record', from, multiaddrs: record.multiaddrs, envelope: bytes }
    }
    if (equal(env.payloadType, AudioMessage.CODEC) && await env.validate(AudioMessage.DOMAIN)) {
      return { type: 'message', from, text: decoder.decode(env.payload) }
    }
  } catch {}
  return undefined
}

/** Anything that can put bytes on the air and hear bytes back: speaker+mic, a radio, a test loopback. */
export interface AudioLink {
  send: (frame: Uint8Array) => Promise<void>
  onFrame: (cb: (frame: Uint8Array) => void) => void
}

export interface AudioServiceEvents extends PeerDiscoveryEvents {
  message: CustomEvent<{ from: PeerId, text: string }>
}

interface Components {
  privateKey: PrivateKey
  addressManager: { getAddresses: () => Multiaddr[] }
}

/** libp2p service: peer discovery + signed text messages over an AudioLink. */
export class AudioService extends TypedEventEmitter<AudioServiceEvents> implements PeerDiscovery, PeerDiscoveryProvider, Startable {
  readonly [peerDiscoverySymbol] = this
  readonly [Symbol.toStringTag] = '@libp2p/audio'
  readonly [serviceCapabilities] = ['@libp2p/peer-discovery']
  private readonly components: Components
  private readonly link: AudioLink
  private readonly self: PeerId
  private running = false

  constructor (components: Components, link: AudioLink) {
    super()
    this.components = components
    this.link = link
    this.self = peerIdFromPublicKey(components.privateKey.publicKey)
    link.onFrame(bytes => { void this.receive(bytes) })
  }

  start (): void { this.running = true }
  stop (): void { this.running = false }

  /** Broadcast our signed PeerRecord, with as many of our addresses as fit in one frame. */
  async announce (): Promise<void> {
    const addrs = this.components.addressManager.getAddresses()
    for (let n = addrs.length; n >= 0; n--) {
      try { return await this.link.send(await sealPeerRecord(this.components.privateKey, addrs.slice(0, n))) } catch (err) {
        if (!(err instanceof RangeError)) throw err
      }
    }
  }

  async say (text: string): Promise<void> {
    await this.link.send(await sealMessage(text, this.components.privateKey))
  }

  private async receive (bytes: Uint8Array): Promise<void> {
    if (!this.running) return
    const frame = await openFrame(bytes)
    if (frame == null || frame.from.equals(this.self)) return
    if (frame.type === 'peer-record') {
      this.safeDispatchEvent('peer', { detail: { id: frame.from, multiaddrs: frame.multiaddrs } })
    } else {
      this.safeDispatchEvent('message', { detail: { from: frame.from, text: frame.text } })
    }
  }
}

export function audio (link: AudioLink): (components: Components) => AudioService {
  return (components) => new AudioService(components, link)
}
