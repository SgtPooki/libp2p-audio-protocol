// Audio <-> pubsub bridge: a message said into a room reaches a gossipsub topic with its signature
// intact, and a signed envelope published on the topic is played into the room. Any libp2p node
// that also has a network link can be the bridge; nothing on either side needs to know it exists.
//
// Loops: the audio service rejects a message it already delivered (same sender and sentAt), so a
// bridge hearing its own relay, or two bridges in one room, deliver each message once. Plain-text
// pubsub messages (not envelopes) are re-signed by the bridge with the original publisher named.

import { serviceDependencies } from '@libp2p/interface'
import { openFrame, sealMessage, type AudioService } from './protocol.ts'
import type { PeerId, PrivateKey, Startable } from '@libp2p/interface'

/** The slice of a libp2p PubSub we use, so no pubsub package is a dependency. */
export interface PubSubLike {
  subscribe: (topic: string) => void
  publish: (topic: string, data: Uint8Array) => Promise<unknown>
  addEventListener: (type: 'message', cb: (evt: CustomEvent<{ topic: string, data: Uint8Array, from?: PeerId }>) => void) => void
}

export interface BridgeComponents { privateKey: PrivateKey, pubsub: PubSubLike, audio: AudioService }

export interface BridgeInit {
  /**
   * Also play plain-text topic messages, re-signed under this node's key with the publisher named.
   * Off by default: it lets any publisher put words in the bridge's mouth. Signed envelopes always relay.
   */
  relayPlainText?: boolean
  /** Topic messages waiting for airtime; more are dropped (a flood on the topic must not own the room). Default 4. */
  queue?: number
}

export class AudioBridge implements Startable {
  readonly [Symbol.toStringTag] = '@libp2p/audio-bridge'
  readonly [serviceDependencies] = ['@libp2p/audio']
  private readonly c: BridgeComponents
  private readonly topic: string
  private readonly init: Required<BridgeInit>
  private running = false
  private readonly queue: Uint8Array[] = []
  private readonly queued = new Set<string>() // sender/sentAt of envelopes waiting or playing
  private playing = false

  constructor (components: BridgeComponents, topic: string, init: BridgeInit = {}) {
    this.c = components
    this.topic = topic
    this.init = { relayPlainText: false, queue: 4, ...init }
    // room -> topic: the raw signed envelope, so subscribers verify the original speaker
    components.audio.addEventListener('message', e => {
      if (!this.running) return
      void components.pubsub.publish(topic, e.detail.envelope).catch(() => {})
    })
    // topic -> room
    components.pubsub.addEventListener('message', e => {
      if (!this.running || e.detail.topic !== topic) return
      this.toAir(e.detail.data, e.detail.from).catch(() => {})
    })
  }

  start (): void { this.running = true }
  afterStart (): void { this.c.pubsub.subscribe(this.topic) } // pubsub itself must be started first
  stop (): void { this.running = false }

  private async toAir (data: Uint8Array, from?: PeerId): Promise<void> {
    const frame = await openFrame(data)
    let bytes: Uint8Array
    let key: string
    if (frame?.type === 'message') {
      key = `${frame.from}/${frame.sentAt}`
      if (this.c.audio.heard(frame.from, frame.sentAt)) return // came from this room (maybe via us): don't echo it back
      bytes = data
    } else {
      if (!this.init.relayPlainText) return
      const text = new TextDecoder().decode(data)
      if (text.length === 0 || text.length > 100) return
      bytes = await sealMessage(`${from != null ? `…${from.toString().slice(-6)}: ` : ''}${text}`, this.c.privateKey)
      key = `plain/${from}/${Date.now()}`
    }
    if (bytes.length > 235 || this.queued.has(key) || this.queue.length >= this.init.queue) return
    this.queued.add(key)
    this.queue.push(bytes)
    if (this.playing) return
    this.playing = true
    try {
      for (let next = this.queue.shift(); next != null; next = this.queue.shift()) {
        await this.c.audio.send(next).catch(() => {})
      }
    } finally { this.playing = false; this.queued.clear() }
  }
}

/** `services: { audio: audio(link), pubsub: gossipsub(), bridge: audioBridge('my-topic') }` */
export function audioBridge (topic: string, init?: BridgeInit): (components: BridgeComponents) => AudioBridge {
  return (components) => new AudioBridge(components, topic, init)
}
