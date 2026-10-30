import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLibp2p } from 'libp2p'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { multiaddr } from '@multiformats/multiaddr'
import { audioTransport, AUDIO_DEFAULTS } from '../src/transport.ts'
import { audio } from '../src/protocol.ts'
import { timedRoom, stopTime } from './room-time.ts'

// rto in virtual seconds: a max frame on voice is ~21 s; keep retries low so a stuck test ends
const base = { rto: 22, retries: 3, handshake: 'lean' as const }
const VARIANTS: Array<[string, { lbt: boolean, selfGain?: number, paths?: number }, { prioritySlot: number }]> = [
  ['no listen-before-talk, no priority', { lbt: false }, { prioritySlot: 0 }],
  ['listen-before-talk', { lbt: true }, { prioritySlot: 0 }],
  ['listen-before-talk + responder priority', { lbt: true }, { prioritySlot: 1 }],
  // a node hears its own speaker louder than the room: its decoder sees its own frames (the link drops own-role frames)
  ['listen-before-talk + responder priority, hearing own speaker', { lbt: true, selfGain: 0.5 }, { prioritySlot: 1 }],
  // every path its own level (0 to -18 dB) and delay (0-30 ms): a far dialer and a near one, asymmetric answers
  ['listen-before-talk + responder priority, per-path levels to -18 dB', { lbt: true, paths: 18 }, { prioritySlot: 1 }]
]

for (const [label, roomOpts, linkOpts] of VARIANTS) for (const seed of [1, 2, 3]) test(`two conversations in one room with real overlap: ${label}, seed ${seed}`, async () => {
  const room = timedRoom({ rate: 16000, seed, ...roomOpts })
  // the link's backoff uses Math.random; seed it so the row is reproducible
  const realRandom = Math.random
  let s = seed * 7919
  Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
  try {
    const node = async (listen: boolean) => {
      const l = room.link()
      return createLibp2p({ ...AUDIO_DEFAULTS, transports: [audioTransport(l, { ...base, ...linkOpts })], connectionEncrypters: [noise()], streamMuxers: [yamux({ enableKeepAlive: false })], services: { audio: audio(l) }, ...(listen ? { addresses: { listen: ['/audio/voice'] } } : {}) })
    }
    const [a, b, c, d] = await Promise.all([node(true), node(false), node(true), node(false)])
    for (const n of [a, c]) await n.handle('/echo/1.0.0', stream => { stream.addEventListener('message', e => { stream.send(e.data) }) })
    const echoes: string[] = []
    const talk = async (dialer: typeof b, listener: typeof a, text: string): Promise<void> => {
      const conn = await dialer.dial(multiaddr(`/audio/voice/p2p/${listener.peerId}`))
      const stream = await conn.newStream('/echo/1.0.0')
      const echoed = new Promise<void>(resolve => stream.addEventListener('message', () => { echoes.push(text); resolve() }, { once: true }))
      stream.send(new TextEncoder().encode(text))
      await echoed
    }
    const both = Promise.all([talk(b, a, 'b to a'), talk(d, c, 'd to c')])
    both.catch(() => {})
    const secs = await room.run(() => echoes.length === 2, 900)
    console.log(`${label}, seed ${seed}: ${echoes.length}/2 echoed in ${secs.toFixed(0)} s of virtual time, ${room.stats.frames} frames, ${room.stats.overlaps} overlapping (${room.stats.sameStep} started in the same step), ${room.stats.airtime.toFixed(0)} s on air`)
    // carrier sense through the real busy()/tailLeft(): the only overlaps left are nodes that started inside the same
    // 100 ms step (neither could hear the other yet). Without it the jittered retries still get through, colliding
    // most of the way; that row is the baseline
    assert.equal(echoes.length, 2)
    if (roomOpts.lbt) assert.ok(room.stats.overlaps <= 2 * room.stats.sameStep, `${room.stats.overlaps} overlapping frames, only ${room.stats.sameStep} same-step pairs`)
    else assert.ok(room.stats.overlaps >= 6, `${room.stats.overlaps} overlaps without carrier sense`)
    await Promise.all([a.stop(), b.stop(), c.stop(), d.stop()])
    await both.catch(() => {})
  } finally { stopTime(); Math.random = realRandom }
})

// Hidden terminals: two dialers both hear the listener but not each other, so carrier sense never sees the other's
// frame and every SYN that is not jittered apart collides at the listener. Nodes: 0 listener, 1 and 2 dialers.
for (const seed of [1, 2, 3]) test(`hidden terminals: two dialers deaf to each other dial one listener, seed ${seed}`, async () => {
  const room = timedRoom({ rate: 16000, seed, lbt: true, deaf: [[1, 2]] })
  const realRandom = Math.random
  let s = seed * 7919
  Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
  try {
    const node = async (listen: boolean) => {
      const l = room.link()
      return createLibp2p({ ...AUDIO_DEFAULTS, transports: [audioTransport(l, { ...base, prioritySlot: 1 })], connectionEncrypters: [noise()], streamMuxers: [yamux({ enableKeepAlive: false })], services: { audio: audio(l) }, ...(listen ? { addresses: { listen: ['/audio/voice'] } } : {}) })
    }
    const [a, b, c] = await Promise.all([node(true), node(false), node(false)])
    await a.handle('/echo/1.0.0', stream => { stream.addEventListener('message', e => { stream.send(e.data) }) })
    const echoes: string[] = []
    const talk = async (dialer: typeof b, text: string): Promise<void> => {
      const conn = await dialer.dial(multiaddr(`/audio/voice/p2p/${a.peerId}`))
      const stream = await conn.newStream('/echo/1.0.0')
      const echoed = new Promise<void>(resolve => stream.addEventListener('message', () => { echoes.push(text); resolve() }, { once: true }))
      stream.send(new TextEncoder().encode(text))
      await echoed
    }
    const both = Promise.all([talk(b, 'b to a'), talk(c, 'c to a')])
    both.catch(() => {})
    const secs = await room.run(() => echoes.length === 2, 900)
    console.log(`hidden terminals, seed ${seed}: ${echoes.length}/2 echoed in ${secs.toFixed(0)} s of virtual time, ${room.stats.frames} frames, ${room.stats.overlaps} overlapping (${room.stats.sameStep} started in the same step), ${room.stats.airtime.toFixed(0)} s on air`)
    assert.equal(echoes.length, 2)
    await Promise.all([a.stop(), b.stop(), c.stop()])
    await both.catch(() => {})
  } finally { stopTime(); Math.random = realRandom }
})
