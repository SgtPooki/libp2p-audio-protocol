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

export class AudioBridge implements Startable {
  readonly [Symbol.toStringTag] = '@libp2p/audio-bridge'
  readonly [serviceDependencies] = ['@libp2p/audio']
  private readonly c: BridgeComponents
  private readonly topic: string
  private running = false

  constructor (components: BridgeComponents, topic: string) {
    this.c = components
    this.topic = topic
    // room -> topic: the raw signed envelope, so subscribers verify the original speaker
    components.audio.addEventListener('message', e => {
      if (!this.running) return
      void components.pubsub.publish(topic, e.detail.envelope).catch(() => {})
    })
    // topic -> room
    components.pubsub.addEventListener('message', e => {
      if (!this.running || e.detail.topic !== topic) return
      void this.toAir(e.detail.data, e.detail.from)
    })
  }

  start (): void { this.running = true }
  afterStart (): void { this.c.pubsub.subscribe(this.topic) } // pubsub itself must be started first
  stop (): void { this.running = false }

  private async toAir (data: Uint8Array, from?: PeerId): Promise<void> {
    const frame = await openFrame(data)
    if (frame?.type === 'message') {
      if (this.c.audio.heard(frame.from, frame.sentAt)) return // came from this room (maybe via us): don't echo it back
      await this.c.audio.send(data)
      return
    }
    // not an audio envelope: a plain pubsub message; say it under our key, naming the publisher
    const text = new TextDecoder().decode(data)
    if (text.length === 0 || text.length > 100) return
    await this.c.audio.send(await sealMessage(`${from != null ? `…${from.toString().slice(-6)}: ` : ''}${text}`, this.c.privateKey))
  }
}

/** `services: { audio: audio(link), pubsub: gossipsub(), bridge: audioBridge('my-topic') }` */
export function audioBridge (topic: string): (components: BridgeComponents) => AudioBridge {
  return (components) => new AudioBridge(components, topic)
}
