// libp2p over audio: every frame on air is a libp2p signed envelope (RFC 0002).
//  - a signed PeerRecord announces "I am <peerId>, reach me at <multiaddrs>" (peer discovery)
//  - a signed AudioMessage carries short text, a send time, and optionally a heard challenge
// Listeners verify the signature, so a heard frame proves which peer sent it.
// Replay handling follows docs/threat-model.md (T2-T6).

import { decode, encode } from 'cborg'
import { PeerRecord, RecordEnvelope } from '@libp2p/peer-record'
import { peerIdFromPublicKey } from '@libp2p/peer-id'
import { peerDiscoverySymbol, serviceCapabilities } from '@libp2p/interface'
import { TypedEventEmitter } from 'main-event'
import { MAX_PAYLOAD } from './modem.ts'
import { chunks, ChunkCollector, fnv1a, isChunk } from './broadcast.ts'
import { ContentPointer, decodeContent, encodeContent } from './content.ts'
import { isLinkFrame } from './link.ts'
import type { CID } from 'multiformats/cid'
import type { PeerDiscovery, PeerDiscoveryEvents, PeerDiscoveryProvider, PeerId, PrivateKey, Startable } from '@libp2p/interface'
import type { Multiaddr } from '@multiformats/multiaddr'

/**
 * Signed payload, a CBOR map (multicodec `cbor`, 0x51): { v: 1, t: sentAt ms, c: [heard challenges, 8 bytes each], m: text }.
 * `sentAt` is strictly increasing per sender, so it doubles as a sequence number.
 */
export class AudioMessage {
  static DOMAIN = 'libp2p-audio-message'
  static CODEC = Uint8Array.of(0x51)
  readonly domain = AudioMessage.DOMAIN
  readonly codec = AudioMessage.CODEC
  readonly text: string
  readonly sentAt: number
  readonly challenges: Uint8Array[]

  constructor (text: string, sentAt: number, challenges: Uint8Array[] = []) {
    this.text = text
    this.sentAt = sentAt
    this.challenges = challenges
  }

  marshal (): Uint8Array {
    return encode({ v: 1, t: this.sentAt, c: this.challenges, m: this.text })
  }

  static unmarshal (b: Uint8Array): AudioMessage | undefined {
    try {
      const o = decode(b)
      if (o.v !== 1 || !Number.isInteger(o.t) || o.t < 0 || typeof o.m !== 'string' || !Array.isArray(o.c) || o.c.length > MAX_HEARD) return undefined
      if (!o.c.every((c: unknown) => c instanceof Uint8Array && c.length === 8)) return undefined
      return new AudioMessage(o.m, o.t, o.c)
    } catch { return undefined }
  }

  equals (other: unknown): boolean {
    return other instanceof AudioMessage && other.text === this.text && other.sentAt === this.sentAt
  }
}

/** Unsigned presence challenge: [0xC1][nonce: 8 bytes]. Harmless if forged: it only asks a question. */
const CHALLENGE_MAGIC = 0xc1
const CHALLENGE_TTL = 300_000 // a challenge proves presence only for replies within 5 minutes
const MAX_HEARD = 3 // messages echo up to 3 recent challenges, so a junk challenge can't push out a real one
const MAX_PEERS = 1024 // bound per-peer replay state
const isChallenge = (b: Uint8Array): boolean => b.length === 9 && b[0] === CHALLENGE_MAGIC

export type Frame =
  | { type: 'peer-record', from: PeerId, multiaddrs: Multiaddr[], seq: bigint, envelope: Uint8Array }
  | { type: 'message', from: PeerId, text: string, sentAt: number, challenges: Uint8Array[] }
  | { type: 'content-pointer', from: PeerId, pointer: ContentPointer, envelope: Uint8Array }

const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i])
const hex = (b: Uint8Array): string => Array.from(b, v => v.toString(16).padStart(2, '0')).join('')

const sealEnvelope = async (record: PeerRecord | AudioMessage | ContentPointer, key: PrivateKey): Promise<Uint8Array> =>
  (await RecordEnvelope.seal(record, key)).marshal()

function fits (bytes: Uint8Array, max = MAX_PAYLOAD): Uint8Array {
  if (bytes.length > max) throw new RangeError(`frame is ${bytes.length} bytes, max is ${max}; use broadcast() for long messages`)
  return bytes
}

export const sealMessage = async (text: string, key: PrivateKey, sentAt = Date.now(), challenges: Uint8Array[] = []): Promise<Uint8Array> =>
  sealEnvelope(new AudioMessage(text, sentAt, challenges), key)

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
      return { type: 'message', from, text: msg.text, sentAt: msg.sentAt, challenges: msg.challenges }
    }
    if (equal(env.payloadType, ContentPointer.CODEC) && await env.validate(ContentPointer.DOMAIN)) {
      const pointer = ContentPointer.unmarshal(env.payload)
      if (pointer == null) return undefined
      return { type: 'content-pointer', from, pointer, envelope: bytes }
    }
  } catch {}
  return undefined
}

/** Anything that can put bytes on the air and hear bytes back: speaker+mic, a radio, a test loopback. */
export interface AudioLink {
  /** Resolves when the frame has finished playing. Sends are sequential. */
  send: (frame: Uint8Array) => Promise<void>
  /** Adds a listener; every decoded frame goes to every listener (the discovery service and the transport share one link). */
  onFrame: (cb: (frame: Uint8Array) => void) => void
  /** Largest frame this link carries. Default: the modem's 235. A Meshtastic link is 233, MeshCore 165. */
  maxFrame?: number
}

export interface MessageDetail {
  from: PeerId
  text: string
  sentAt: number
  /** True if the message carries a challenge WE broadcast in the last 5 minutes: the signer heard us after we asked (T3). */
  present: boolean
}

export interface ContentDetail {
  from: PeerId
  name: string
  cid: CID
  bytes: Uint8Array
  headline: string
  sentAt: number
  validUntil: number
}

export interface AudioServiceEvents extends PeerDiscoveryEvents {
  message: CustomEvent<MessageDetail>
  /** A signed pointer was heard (the headline is signed too); the bytes may still be on their way. */
  pointer: CustomEvent<ContentDetail & { bytes?: undefined }>
  /** Content rebuilt from chunks and verified against the CID in its signed pointer. */
  content: CustomEvent<ContentDetail>
  /** Someone asked who is here; our next signed broadcast message answers it. */
  challenge: CustomEvent<{ nonce: Uint8Array }>
  /** A validly signed frame we refused, so a UI can say why (e.g. sender's clock is off). */
  rejected: CustomEvent<{ from: PeerId, reason: 'stale' | 'future' | 'duplicate' | 'old-record' | 'expired', sentAt?: number }>
}

export interface RepeaterInit {
  /** Publishers (PeerId strings) whose verified content we re-send. Without an allowlist a repeater amplifies spam. */
  allow: string[]
  /** Fountain loops to send per content item. Default 2. */
  loops?: number
}

export interface AudioServiceInit {
  /** Drop messages older than this (T2). Default 1 hour; clocks after a disaster may be off, so stay generous. */
  maxAgeMs?: number
  /** Drop messages dated further than this in the future. Default 5 minutes. */
  maxSkewMs?: number
  /** Anti-replay window: per sender, remember sentAt values this far back; older ones are rejected (T5, T6). Default 10 minutes. */
  windowMs?: number
  /** Fountain chunk data size for broadcast() and publish(). Default 60 bytes. */
  blockSize?: number
  /** Opt in to repeating verified content from allowlisted publishers. Off by default: a phone in a pocket should stay quiet. */
  repeat?: RepeaterInit
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
  private readonly maxFrame: number
  private running = false
  private lastSentAt = 0
  private readonly collector = new ChunkCollector()
  private readonly seen = new Map<string, { highest: number, sentAts: Set<number> }>() // messages per sender
  private readonly recordSeq = new Map<string, bigint>() // highest PeerRecord seq per peer (T4)
  private readonly myChallenges = new Map<string, number>() // nonce hex -> when we sent it
  private heardChallenges: Array<{ nonce: Uint8Array, at: number }> = []
  // content: pointers by chunk msgId, chunk-rebuilt bytes waiting for their pointer, finished items
  private readonly pointers = new Map<number, { from: PeerId, pointer: ContentPointer, envelope: Uint8Array }>()
  private readonly orphans = new Map<number, Uint8Array>()
  private readonly contentDone = new Set<number>()
  private readonly pointerSeq = new Map<string, number>() // `${peer}/${name}` -> highest sentAt (T4-style)
  private readonly relaying = new Set<number>() // msgIds this repeater is sending
  private heardChunks = new Map<number, number>() // msgId -> chunks heard from others while relaying (Trickle suppression)
  private chain = Promise.resolve()

  constructor (components: Components, link: AudioLink, init: AudioServiceInit = {}) {
    super()
    this.components = components
    this.link = link
    this.init = { maxAgeMs: 3_600_000, maxSkewMs: 300_000, windowMs: 600_000, blockSize: 60, repeat: undefined as unknown as RepeaterInit, ...init }
    this.maxFrame = Math.min(link.maxFrame ?? MAX_PAYLOAD, MAX_PAYLOAD)
    this.self = peerIdFromPublicKey(components.privateKey.publicKey)
    // one frame at a time, in the order heard: a pointer must be in before the chunks that follow it
    link.onFrame(bytes => { this.chain = this.chain.then(async () => this.receive(bytes)).catch(() => {}) })
  }

  start (): void { this.running = true }
  stop (): void { this.running = false }

  /** Broadcast our signed PeerRecord, with as many of our addresses as fit in one frame. */
  async announce (): Promise<void> {
    const addrs = this.components.addressManager.getAddresses()
    for (let n = addrs.length; n >= 0; n--) {
      const env = await sealPeerRecord(this.components.privateKey, addrs.slice(0, n))
      if (env.length <= this.maxFrame) return await this.link.send(env)
    }
  }

  /** Send a short signed message as one frame. Includes the last challenge we heard (within 5 minutes). */
  async say (text: string): Promise<void> {
    await this.link.send(fits(await this.seal(text), this.maxFrame))
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

  /**
   * Publish `bytes` under a name: one signed pointer frame (CID, size, headline, expiry), then
   * `loops` x K fountain chunks. Listeners verify the rebuilt bytes against the CID. Repeat the whole
   * thing to keep the carousel going; a newer `publish` of the same name replaces the old one.
   */
  async publish (bytes: Uint8Array, opts: { name: string, headline?: string, validFor?: number, loops?: number }): Promise<ContentPointer> {
    const { cid, encoded, encoding } = await encodeContent(bytes)
    this.lastSentAt = Math.max(Date.now(), this.lastSentAt + 1)
    const pointer = new ContentPointer({ name: opts.name, sentAt: this.lastSentAt, validFor: opts.validFor ?? 86_400, cid, len: bytes.length, encoding, encLen: encoded.length, msgId: fnv1a(encoded), headline: opts.headline ?? '' })
    await this.link.send(fits(await sealEnvelope(pointer, this.components.privateKey), this.maxFrame))
    await this.sendChunks(encoded, opts.loops ?? 2, 0)
    return pointer
  }

  private async sendChunks (encoded: Uint8Array, loops: number, start: number, msgId?: number): Promise<void> {
    const k = Math.ceil(encoded.length / this.init.blockSize)
    const gen = chunks(encoded, this.init.blockSize, start)
    for (let sent = 0; sent < k * loops;) {
      if (msgId != null && !this.relaying.has(msgId)) return // a newer pointer replaced this content
      // Trickle-style suppression: if others sent chunks of this content since our last one, skip one index
      // and wait, but at most once per chunk we send, so a looping source never silences a repeater at the edge
      if (msgId != null && (this.heardChunks.get(msgId) ?? 0) > 0) { this.heardChunks.set(msgId, 0); gen.next() }
      await this.link.send(gen.next().value as Uint8Array)
      sent++
    }
  }

  /** Ask "who is here right now?": peers whose next message carries this nonce were listening after now (T3). */
  async challenge (): Promise<void> {
    const nonce = crypto.getRandomValues(new Uint8Array(8))
    const now = Date.now()
    for (const [k, at] of this.myChallenges) if (now - at > CHALLENGE_TTL) this.myChallenges.delete(k)
    this.myChallenges.set(hex(nonce), now)
    await this.link.send(Uint8Array.of(CHALLENGE_MAGIC, ...nonce))
  }

  private async seal (text: string): Promise<Uint8Array> {
    this.lastSentAt = Math.max(Date.now(), this.lastSentAt + 1) // strictly increasing per sender
    const now = Date.now()
    const heard = this.heardChallenges.filter(c => now - c.at < CHALLENGE_TTL).map(c => c.nonce)
    return await sealMessage(text, this.components.privateKey, this.lastSentAt, heard)
  }

  /** Chunks rebuilt into bytes and a pointer for them: verify against the CID, deliver once, maybe repeat. */
  private async finishContent (entry: { from: PeerId, pointer: ContentPointer, envelope: Uint8Array }, encoded: Uint8Array): Promise<void> {
    const { from, pointer } = entry
    // ponytail: content is remembered by its chunk id, so the same bytes re-published under a new pointer
    // fire `pointer` but not `content` again; cache bytes by CID if renewals need to be re-delivered or re-sent
    if (this.contentDone.has(pointer.msgId)) return
    const bytes = await decodeContent(encoded, pointer)
    if (bytes == null) return // forged or damaged: the collector already dropped its rows; wait for fresh chunks
    this.contentDone.add(pointer.msgId)
    if (this.contentDone.size > 256) this.contentDone.delete(this.contentDone.values().next().value!)
    this.safeDispatchEvent('content', { detail: { from, name: pointer.name, cid: pointer.cid, bytes, headline: pointer.headline, sentAt: pointer.sentAt, validUntil: pointer.validUntil } })
    const repeat = this.init.repeat
    if (repeat == null || !repeat.allow.includes(from.toString()) || Date.now() > pointer.validUntil) return
    // repeat: the pointer unchanged (it is signed), then fresh chunks from a random start index
    this.relaying.add(pointer.msgId)
    this.heardChunks.set(pointer.msgId, 0)
    await this.link.send(entry.envelope)
    const k = Math.ceil(encoded.length / this.init.blockSize)
    await this.sendChunks(encoded, repeat.loops ?? 2, k + Math.floor(Math.random() * 0x8000), pointer.msgId)
    this.relaying.delete(pointer.msgId)
    this.heardChunks.delete(pointer.msgId)
  }

  private async receive (bytes: Uint8Array): Promise<void> {
    if (!this.running || isLinkFrame(bytes)) return
    if (isChallenge(bytes)) {
      this.heardChallenges = [...this.heardChallenges, { nonce: bytes.slice(1), at: Date.now() }].slice(-MAX_HEARD)
      this.safeDispatchEvent('challenge', { detail: { nonce: bytes.slice(1) } })
      return
    }
    let rebuilt = false
    if (isChunk(bytes)) {
      const id = new DataView(bytes.buffer, bytes.byteOffset).getUint32(1)
      if (this.relaying.has(id)) this.heardChunks.set(id, (this.heardChunks.get(id) ?? 0) + 1)
      const env = this.collector.add(bytes)
      if (env == null) return
      const p = this.pointers.get(fnv1a(env))
      if (p != null) return await this.finishContent(p, env)
      bytes = env
      rebuilt = true
    }
    const frame = await openFrame(bytes)
    if (frame == null) {
      // content rebuilt before its pointer was heard: keep a few until the pointer arrives
      if (rebuilt && !this.contentDone.has(fnv1a(bytes))) {
        this.orphans.set(fnv1a(bytes), bytes)
        if (this.orphans.size > 8) this.orphans.delete(this.orphans.keys().next().value!)
      }
      return
    }
    if (frame.from.equals(this.self)) return
    const from = frame.from
    const key = from.toString()

    if (frame.type === 'content-pointer') {
      const { pointer } = frame
      const now = Date.now()
      if (pointer.sentAt - now > this.init.maxSkewMs) { this.safeDispatchEvent('rejected', { detail: { from, reason: 'future', sentAt: pointer.sentAt } }); return }
      if (now >= pointer.validUntil) { this.safeDispatchEvent('rejected', { detail: { from, reason: 'expired', sentAt: pointer.sentAt } }); return }
      const seqKey = `${key}/${pointer.name}`
      const prev = this.pointerSeq.get(seqKey)
      if (prev != null && pointer.sentAt <= prev) { this.safeDispatchEvent('rejected', { detail: { from, reason: 'old-record', sentAt: pointer.sentAt } }); return }
      this.pointerSeq.set(seqKey, pointer.sentAt)
      if (this.pointerSeq.size > MAX_PEERS) this.pointerSeq.delete(this.pointerSeq.keys().next().value!)
      // a newer version of this name retires the old one, including any relay in progress
      for (const [id, p] of this.pointers) if (p.from.equals(from) && p.pointer.name === pointer.name) { this.pointers.delete(id); this.relaying.delete(id) }
      const entry = { from, pointer, envelope: frame.envelope }
      this.pointers.set(pointer.msgId, entry)
      if (this.pointers.size > 32) this.pointers.delete(this.pointers.keys().next().value!)
      this.safeDispatchEvent('pointer', { detail: { from, name: pointer.name, cid: pointer.cid, headline: pointer.headline, sentAt: pointer.sentAt, validUntil: pointer.validUntil } })
      const orphan = this.orphans.get(pointer.msgId)
      if (orphan != null) { this.orphans.delete(pointer.msgId); await this.finishContent(entry, orphan) }
      return
    }

    if (frame.type === 'peer-record') {
      const prev = this.recordSeq.get(key)
      if (prev != null && frame.seq <= prev) {
        this.safeDispatchEvent('rejected', { detail: { from, reason: 'old-record' } })
        return
      }
      this.recordSeq.delete(key)
      this.recordSeq.set(key, frame.seq)
      if (this.recordSeq.size > MAX_PEERS) this.recordSeq.delete(this.recordSeq.keys().next().value!)
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
    this.seen.delete(key)
    this.seen.set(key, s) // re-insert so the map stays in least-recently-heard order
    if (this.seen.size > MAX_PEERS) this.seen.delete(this.seen.keys().next().value!)

    const present = frame.challenges.some(c => {
      const issued = this.myChallenges.get(hex(c))
      return issued != null && now - issued <= CHALLENGE_TTL
    })
    this.safeDispatchEvent('message', { detail: { from, text: frame.text, sentAt, present } })
  }
}

export function audio (link: AudioLink, init?: AudioServiceInit): (components: Components) => AudioService {
  return (components) => new AudioService(components, link, init)
}
