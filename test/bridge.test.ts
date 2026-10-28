import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { floodsub } from '@libp2p/floodsub'
import { identify } from '@libp2p/identify'
import { generateKeyPair } from '@libp2p/crypto/keys'
import { audio, openFrame, sealMessage } from '../src/protocol.ts'
import { audioBridge } from '../src/bridge.ts'
import { air } from './room.ts'

const TOPIC = 'town-square'
const settle = async (ms = 50): Promise<void> => { await new Promise(r => setTimeout(r, ms)) }

test('bridge: a message said in the room reaches a pubsub topic signed by the speaker, and back', async () => {
  const room = air({ rate: 16000 })
  // floodsub here because it targets libp2p 3; the bridge only uses the PubSub interface, gossipsub works the same once it does
  const net = { transports: [tcp()], connectionEncrypters: [noise()], streamMuxers: [yamux()], addresses: { listen: ['/ip4/127.0.0.1/tcp/0'] } }
  // B: a phone in the room, audio only. A: the bridge, in the room and on the network. C: a node somewhere on the network.
  const b = await createLibp2p({ services: { audio: audio(room.link()) } })
  const a = await createLibp2p({ ...net, services: { audio: audio(room.link()), pubsub: floodsub(), identify: identify(), bridge: audioBridge(TOPIC) as any } })
  const c = await createLibp2p({ ...net, services: { pubsub: floodsub(), identify: identify() } })
  try {
    await c.dial(a.getMultiaddrs()[0])
    ;(c.services.pubsub as any).subscribe(TOPIC)
    for (let i = 0; i < 100 && (c.services.pubsub as any).getSubscribers(TOPIC).length === 0; i++) await settle()
    assert.ok((c.services.pubsub as any).getSubscribers(TOPIC).length > 0, 'C sees the bridge subscribed')

    // room -> network
    const onNet = new Promise<any>(resolve => (c.services.pubsub as any).addEventListener('message', (e: any) => resolve(e.detail), { once: true }))
    await b.services.audio.say('water at the north gate')
    const msg = await onNet
    assert.equal(msg.topic, TOPIC)
    const frame = await openFrame(msg.data)
    assert.equal(frame?.type, 'message')
    assert.equal((frame as any).text, 'water at the north gate')
    assert.ok((frame as any).from.equals(b.peerId), 'the envelope on the topic is still signed by the phone in the room')

    // network -> room, as a signed envelope from C's own key
    const heardSigned = new Promise<any>(resolve => b.services.audio.addEventListener('message', e => resolve(e.detail), { once: true }))
    const key = await generateKeyPair('Ed25519')
    await (c.services.pubsub as any).publish(TOPIC, await sealMessage('shelter open', key))
    const h1 = await heardSigned
    assert.equal(h1.text, 'shelter open')

    // network -> room, plain text: the bridge signs it and names the publisher
    const heardPlain = new Promise<any>(resolve => b.services.audio.addEventListener('message', e => resolve(e.detail), { once: true }))
    await (c.services.pubsub as any).publish(TOPIC, new TextEncoder().encode('roads closed'))
    const h2 = await heardPlain
    assert.ok(h2.from.equals(a.peerId))
    assert.equal(h2.text, `…${c.peerId.toString().slice(-6)}: roads closed`)

    // the bridge heard its own relays in the room and did not publish them back (no loop)
    let extra = 0
    ;(c.services.pubsub as any).addEventListener('message', () => { extra++ })
    await settle(300)
    assert.equal(extra, 0)
  } finally { await Promise.all([a.stop(), b.stop(), c.stop()]) }
})
