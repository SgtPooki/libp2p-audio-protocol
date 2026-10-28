// libp2p over audio: every frame on air is a libp2p signed envelope (RFC 0002).
//  - a signed PeerRecord announces "I am <peerId>, reach me at <multiaddrs>" (peer discovery)
//  - a signed AudioMessage carries short text, a send time, and optionally a heard challenge
// Listeners verify the signature, so a heard frame proves which peer sent it.
// Replay handling follows docs/threat-model.md (T2-T6).

import { PeerRecord, RecordEnvelope } from '@libp2p/peer-record'
import { peerIdFromPublicKey } from '@libp2p/peer-id'
import { peerDiscoverySymbol, serviceCapabilities } from '@libp2p/interface'
import { TypedEventEmitter } from 'main-event'
import { MAX_PAYLOAD } from './modem.ts'
import { chunks, ChunkCollector, isChunk } from './broadcast.ts'
import type { PeerDiscovery, PeerDiscoveryEvents, PeerDiscoveryProvider, PeerId, PrivateKey, Startable } from '@libp2p/interface'
import type { Multiaddr } from '@multiformats/multiaddr'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Signed payload: [version=1][sentAt: u48 ms since epoch][flags][challenge: 8 bytes if flags&1][utf-8 text]
 * `sentAt` is strictly increasing per sender, so it doubles as a sequence number.
 */
export class AudioMessage {
  static DOMAIN = 'libp2p-audio-message'
  // 0x300001 in the multicodec private-use range, varint encoded
  static CODEC = Uint8Array.of(0x81, 0x80, 0xc0, 0x01)
  readonly domain = AudioMessage.DOMAIN
  readonly codec = AudioMessage.CODEC
  readonly text: string
  readonly sentAt: number
  readonly challenge?: Uint8Array

  constructor (text: string, sentAt: number, challenge?: Uint8Array) {
    this.text = text
    this.sentAt = sentAt
    this.challenge = challenge
  }

  marshal (): Uint8Array {
    const text = encoder.encode(this.text)
    const c = this.challenge
    const out = new Uint8Array(8 + (c != null ? 8 : 0) + text.length)
    const view = new DataView(out.buffer)
    out[0] = 1
    view.setUint16(1, Math.floor(this.sentAt / 2 ** 32))
    view.setUint32(3, this.sentAt >>> 0)
    out[7] = c != null ? 1 : 0
    if (c != null) out.set(c, 8)
    out.set(text, out.length - text.length)
    return out
  }

  static unmarshal (b: Uint8Array): AudioMessage | undefined {
    if (b.length < 8 || b[0] !== 1) return undefined
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
    const sentAt = view.getUint16(1) * 2 ** 32 + view.getUint32(3)
    const hasChallenge = (b[7] & 1) === 1
    if (hasChallenge && b.length < 16) return undefined
    const challenge = hasChallenge ? b.slice(8, 16) : undefined
    return new AudioMessage(decoder.decode(b.subarray(hasChallenge ? 16 : 8)), sentAt, challenge)
  }

  equals (other: unknown): boolean {
    return other instanceof AudioMessage && other.text === this.text && other.sentAt === this.sentAt
  }
}

/** Unsigned presence challenge: [0xC1][nonce: 8 bytes]. Harmless if forged: it only asks a question. */
const CHALLENGE_MAGIC = 0xc1
const isChallenge = (b: Uint8Array): boolean => b.length === 9 && b[0] === CHALLENGE_MAGIC

export type Frame =
  | { type: 'peer-record', from: PeerId, multiaddrs: Multiaddr[], seq: bigint, envelope: Uint8Array }
  | { type: 'message', from: PeerId, text: string, sentAt: number, challenge?: Uint8Array }

const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i])
const hex = (b: Uint8Array): string => Array.from(b, v => v.toString(16).padStart(2, '0')).join('')

const sealEnvelope = async (record: PeerRecord | AudioMessage, key: PrivateKey): Promise<Uint8Array> =>
  (await RecordEnvelope.seal(record, key)).marshal()

function fits (bytes: Uint8Array): Uint8Array {
  if (bytes.length > MAX_PAYLOAD) throw new RangeError(`frame is ${bytes.length} bytes, max is ${MAX_PAYLOAD}; use broadcast() for long messages`)
  return bytes
}

export const sealMessage = async (text: string, key: PrivateKey, sentAt = Date.now(), challenge?: Uint8Array): Promise<Uint8Array> =>
  sealEnvelope(new AudioMessage(text, sentAt, challenge), key)

export const sealPeerRecord = async (key: PrivateKey, multiaddrs: Multiaddr[] = []): Promise<Uint8Array> =>
  sealEnvelope(new PeerRecord({ peerId: peerIdFromPublicKey(key.publicKey), multiaddrs, seqNumber: BigInt(Date.now()) }), key)

/** Parse and verify a frame. Returns undefined for anything unknown or with a bad signature. */
export async function openFrame (bytes: Uint8Array): Promise<Frame | undefined> {
  try {
    const env = RecordEnvelope.createFromProtobuf(bytes)
    const from = peerIdFromPublicKey(env.publicKey)
    if (equal(env.payloadType, PeerRecord.CODEC) && await env.validate(PeerRecord.DOMAIN)) {
      const record = PeerRecord.createFromProtobuf(env.payload)
      if (!record.peerId.equals(from)) return undefined
      return { type: 'peer-record', from, multiaddrs: record.multiaddrs, seq: record.seqNumber, envelope: bytes }
    }
    if (equal(env.payloadType, AudioMessage.CODEC) && await env.validate(AudioMessage.DOMAIN)) {
      const msg = AudioMessage.unmarshal(env.payload)
      if (msg == null) return undefined
      return { type: 'message', from, text: msg.text, sentAt: msg.sentAt, challenge: msg.challenge }
    }
  } catch {}
  return undefined
}

/** Anything that can put bytes on the air and hear bytes back: speaker+mic, a radio, a test loopback. */
export interface AudioLink {
  send: (frame: Uint8Array) => Promise<void>
  onFrame: (cb: (frame: Uint8Array) => void) => void
}

export interface MessageDetail {
  from: PeerId
  text: string
  sentAt: number
  /** True if the message carries a challenge WE broadcast: the signer heard us after we asked (T3). */
  present: boolean
}

export interface AudioServiceEvents extends PeerDiscoveryEvents {
  message: CustomEvent<MessageDetail>
  /** A validly signed frame we refused, so a UI can say why (e.g. sender's clock is off). */
  rejected: CustomEvent<{ from: PeerId, reason: 'stale' | 'future' | 'duplicate' | 'old-record', sentAt?: number }>
}

export interface AudioServiceInit {
  /** Drop messages older than this (T2). Default 1 hour; clocks after a disaster may be off, so stay generous. */
  maxAgeMs?: number
  /** Drop messages dated further than this in the future. Default 5 minutes. */
  maxSkewMs?: number
  /** Anti-replay window: per sender, remember sentAt values this far back; older ones are rejected (T5, T6). Default 10 minutes. */
  windowMs?: number
  /** Fountain chunk data size for broadcast(). Default 60 bytes. */
  blockSize?: number
}

interface Components {
  privateKey: PrivateKey
  addressManager: { getAddresses: () => Multiaddr[] }
}

/** libp2p service: peer discovery, signed messages, looping broadcasts, and replay protection over an AudioLink. */
export class AudioService extends TypedEventEmitter<AudioServiceEvents> implements PeerDiscovery, PeerDiscoveryProvider, Startable {
  readonly [peerDiscoverySymbol] = this
  readonly [Symbol.toStringTag] = '@libp2p/audio'
  readonly [serviceCapabilities] = ['@libp2p/peer-discovery']
  private readonly components: Components
  private readonly link: AudioLink
  private readonly self: PeerId
  private readonly init: Required<AudioServiceInit>
  private running = false
  private lastSentAt = 0
  private readonly collector = new ChunkCollector()
  private readonly seen = new Map<string, { highest: number, sentAts: Set<number> }>() // messages per sender
  private readonly recordSeq = new Map<string, bigint>() // highest PeerRecord seq per peer (T4)
  private readonly myChallenges = new Map<string, number>() // nonce hex -> when we sent it
  private heardChallenge?: { nonce: Uint8Array, at: number }

  constructor (components: Components, link: AudioLink, init: AudioServiceInit = {}) {
    super()
    this.components = components
    this.link = link
    this.init = { maxAgeMs: 3_600_000, maxSkewMs: 300_000, windowMs: 600_000, blockSize: 60, ...init }
    this.self = peerIdFromPublicKey(components.privateKey.publicKey)
    link.onFrame(bytes => { void this.receive(bytes) })
  }

  start (): void { this.running = true }
  stop (): void { this.running = false }

  /** Broadcast our signed PeerRecord, with as many of our addresses as fit in one frame. */
  async announce (): Promise<void> {
    const addrs = this.components.addressManager.getAddresses()
    for (let n = addrs.length; n >= 0; n--) {
      const env = await sealPeerRecord(this.components.privateKey, addrs.slice(0, n))
      if (env.length <= MAX_PAYLOAD) return await this.link.send(env)
    }
  }

  /** Send a short signed message as one frame. Includes the last challenge we heard (within 5 minutes). */
  async say (text: string): Promise<void> {
    await this.link.send(fits(await this.seal(text)))
  }

  /**
   * Broadcast a signed message as fountain-coded chunks, `loops` times over. Listeners who tune in
   * at any point decode it once they've heard about K chunks. Works for messages longer than one frame.
   */
  async broadcast (text: string, loops = 2): Promise<void> {
    const env = await this.seal(text)
    const k = Math.ceil(env.length / this.init.blockSize)
    const gen = chunks(env, this.init.blockSize)
    for (let i = 0; i < k * loops; i++) await this.link.send(gen.next().value as Uint8Array)
  }

  /** Ask "who is here right now?": peers whose next message carries this nonce were listening after now (T3). */
  async challenge (): Promise<void> {
    const nonce = crypto.getRandomValues(new Uint8Array(8))
    this.myChallenges.set(hex(nonce), Date.now())
    await this.link.send(Uint8Array.of(CHALLENGE_MAGIC, ...nonce))
  }

  private async seal (text: string): Promise<Uint8Array> {
    this.lastSentAt = Math.max(Date.now(), this.lastSentAt + 1) // strictly increasing per sender
    const c = this.heardChallenge != null && Date.now() - this.heardChallenge.at < 300_000 ? this.heardChallenge.nonce : undefined
    return await sealMessage(text, this.components.privateKey, this.lastSentAt, c)
  }

  private async receive (bytes: Uint8Array): Promise<void> {
    if (!this.running) return
    if (isChallenge(bytes)) {
      this.heardChallenge = { nonce: bytes.slice(1), at: Date.now() }
      return
    }
    if (isChunk(bytes)) {
      const env = this.collector.add(bytes)
      if (env == null) return
      bytes = env
    }
    const frame = await openFrame(bytes)
    if (frame == null || frame.from.equals(this.self)) return
    const from = frame.from
    const key = from.toString()

    if (frame.type === 'peer-record') {
      const prev = this.recordSeq.get(key)
      if (prev != null && frame.seq <= prev) {
        this.safeDispatchEvent('rejected', { detail: { from, reason: 'old-record' } })
        return
      }
      this.recordSeq.set(key, frame.seq)
      this.safeDispatchEvent('peer', { detail: { id: from, multiaddrs: frame.multiaddrs } })
      return
    }

    const now = Date.now()
    const { sentAt } = frame
    const reject = (reason: 'stale' | 'future' | 'duplicate'): void => {
      this.safeDispatchEvent('rejected', { detail: { from, reason, sentAt } })
    }
    if (now - sentAt > this.init.maxAgeMs) return reject('stale')
    if (sentAt - now > this.init.maxSkewMs) return reject('future')
    const s = this.seen.get(key) ?? { highest: 0, sentAts: new Set<number>() }
    if (s.sentAts.has(sentAt) || sentAt <= s.highest - this.init.windowMs) return reject('duplicate')
    s.sentAts.add(sentAt)
    s.highest = Math.max(s.highest, sentAt)
    for (const t of s.sentAts) if (t <= s.highest - this.init.windowMs) s.sentAts.delete(t)
    this.seen.set(key, s)

    const issued = frame.challenge != null ? this.myChallenges.get(hex(frame.challenge)) : undefined
    this.safeDispatchEvent('message', { detail: { from, text: frame.text, sentAt, present: issued != null } })
  }
}

export function audio (link: AudioLink, init?: AudioServiceInit): (components: Components) => AudioService {
  return (components) => new AudioService(components, link, init)
}
