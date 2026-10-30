import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLibp2p } from 'libp2p'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { ping } from '@libp2p/ping'
import { multiaddr } from '@multiformats/multiaddr'
import { Link } from '../src/link.ts'
import { audioTransport, AUDIO_DEFAULTS, type AudioTransportInit } from '../src/transport.ts'
import { audio } from '../src/protocol.ts'
import { PRESETS } from '../src/modem.ts'
import { air } from './room.ts'

const rate = 16000 // plenty for the voice preset, fast to simulate
const rand = (n: number): Uint8Array => Uint8Array.from({ length: n }, () => Math.random() * 256)
const fast = { rto: 0.05, retries: 20 } // the room has no propagation delay

test('link: 1 KB each way survives 20% frame loss, in order and byte-exact', async () => {
  const room = air({ rate, loss: 0.2 })
  const a = new Link(room.link(), Uint8Array.of(1, 2, 3, 4), fast)
  const b = new Link(room.link(), Uint8Array.of(5, 6, 7, 8), fast)
  const toA: Uint8Array[] = []; const toB: Uint8Array[] = []
  const sentToA = rand(1024); const sentToB = rand(1024)
  // b answers with its own 1 KB as soon as it accepts
  b.listen(conn => { conn.onData = d => toB.push(d); conn.write(sentToA) })
  const { conn } = await a.dial(Uint8Array.of(5, 6, 7, 8))
  conn.onData = d => toA.push(d)
  conn.write(sentToB)
  await conn.close()
  const cat = (parts: Uint8Array[]): Uint8Array => Uint8Array.from(parts.flatMap(p => [...p]))
  assert.deepEqual(cat(toB), sentToB)
  assert.deepEqual(cat(toA), sentToA)
})

const MODES: Array<[string, AudioTransportInit]> = [
  ['noise + yamux (stock upgrader)', {}],
  ['lean: signed handshake + audiomux, encrypted', { handshake: 'lean' }],
  ['lean: sign-only (ham mode)', { handshake: 'lean', encrypt: false }]
]
for (const [mode, init] of MODES) test(`${mode}: two libp2p nodes connect over audio, ping and echo, discovered address dialed`, async () => {
  const room = air({ rate })
  const base = (link: ReturnType<Room['link']>) => ({
    ...AUDIO_DEFAULTS,
    transports: [audioTransport(link, { ...fast, ...init })],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux({ enableKeepAlive: false })],
    services: { ping: ping(), audio: audio(link) }
  })
  const la = room.link(); const lb = room.link()
  const a = await createLibp2p({ ...base(la), addresses: { listen: ['/audio/voice'] } })
  const b = await createLibp2p({ ...base(lb), addresses: { listen: ['/audio/voice'] } })
  try {
    assert.ok(a.getMultiaddrs().some(ma => ma.toString() === `/audio/voice/p2p/${a.peerId}`), 'listens on /audio/voice')
    await a.handle('/echo/1.0.0', stream => { stream.addEventListener('message', e => { stream.send(e.data) }) })

    // discovery: b hears a's PeerRecord over the same audio link, then dials the heard /audio address
    const discovered = new Promise<any>(resolve => b.addEventListener('peer:discovery', e => resolve(e.detail), { once: true }))
    await a.services.audio.announce()
    const info = await discovered
    assert.ok(info.multiaddrs.some((ma: any) => ma.toString() === `/audio/voice`), "the peer store strips /p2p; the heard address is the audio one")

    const before = { ...room.stats }
    const conn = await b.dial(a.peerId)
    assert.equal(conn.status, 'open')
    assert.ok(conn.remoteAddr.equals(multiaddr(`/audio/voice/p2p/${a.peerId}`)))
    const stream = await conn.newStream('/echo/1.0.0')
    const echoed = new Promise<string>(resolve => stream.addEventListener('message', e => resolve(new TextDecoder().decode(e.data.subarray())), { once: true }))
    stream.send(new TextEncoder().encode('hello over sound'))
    assert.equal(await echoed, 'hello over sound')
    const ttfb = { frames: room.stats.frames - before.frames, seconds: room.stats.seconds - before.seconds, bytes: room.stats.bytes - before.bytes }
    console.log(`${mode}: time to first echoed byte: ${ttfb.frames} frames, ${ttfb.bytes} bytes, ${ttfb.seconds.toFixed(1)} s of airtime`)
    assert.ok(ttfb.seconds < (init.handshake === 'lean' ? 55 : 140)) // voice preset (32 parity): lean 47.0 s, stock 127.4 s
    if (init.handshake === 'lean') assert.equal(ttfb.frames, 4, 'SYN+msg1, SYN-ACK+msg2, first stream data, echo')

    const rtt = await b.services.ping.ping(a.peerId)
    assert.ok(rtt >= 0)
    await stream.close()
    await conn.close()
    assert.equal(conn.status, 'closed')
    if (init.handshake === 'lean') {
      // sign-only is readable on air, encrypted is not
      const seen = room.frames.some(f => new TextDecoder('utf-8', { fatal: false }).decode(f).includes('hello over sound'))
      assert.equal(seen, init.encrypt === false, 'plaintext visible on air only in sign-only mode')
    }
  } finally {
    await a.stop(); await b.stop()
  }
})

type Room = ReturnType<typeof air>

for (const [top, dead] of [['fast', []], ['dual', []], ['tri', []], ['turbo', []], ['fast', ['fast']]] as Array<['fast' | 'dual' | 'tri' | 'turbo', string[]]>) test(`preset ladder: dial tries ${top} first${dead.length > 0 ? ', falls back to voice when fast never gets through' : ''}`, async () => {
  const room = air({ rate, presets: { [top]: PRESETS[top], voice: PRESETS.voice }, dead })
  const base = (link: ReturnType<Room['link']>) => ({
    ...AUDIO_DEFAULTS,
    transports: [audioTransport(link, { ...fast, handshake: 'lean' })],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux({ enableKeepAlive: false })],
    services: { audio: audio(link) }
  })
  const la = room.link(); const lb = room.link()
  const a = await createLibp2p({ ...base(la), addresses: { listen: ['/audio/voice'] } })
  const b = await createLibp2p({ ...base(lb) })
  try {
    await a.handle('/echo/1.0.0', stream => { stream.addEventListener('message', e => { stream.send(e.data) }) })
    const before = { ...room.stats }
    const conn = await b.dial(multiaddr(`/audio/voice/p2p/${a.peerId}`))
    const stream = await conn.newStream('/echo/1.0.0')
    const echoed = new Promise<void>(resolve => stream.addEventListener('message', () => resolve(), { once: true }))
    stream.send(new TextEncoder().encode('hi'))
    await echoed
    const secs = room.stats.seconds - before.seconds
    const frames = room.stats.frames - before.frames
    console.log(`ladder ${top}${dead.length > 0 ? ' (fast dead)' : ''}: ${frames} frames, ${secs.toFixed(1)} s of airtime to the echo`)
    if (dead.length === 0) { assert.ok(secs < (top === 'turbo' ? 8 : top === 'tri' ? 10 : top === 'dual' ? 13 : 25), `connected on ${top}`); assert.equal(conn.remoteAddr.getComponents()[0].value, top) }
    else { assert.equal(conn.remoteAddr.getComponents()[0].value, 'voice'); assert.equal(frames, 6, 'two SYNs lost on fast, then SYN, SYN-ACK, data, echo on voice') }
  } finally { await a.stop(); await b.stop() }
})

test('a flood of half-open SYNs does not block a real dial: the oldest half-open one is evicted', async () => {
  const room = air({ rate })
  const a = new Link(room.link(), Uint8Array.of(1, 2, 3, 4), { ...fast, maxConns: 4 })
  const b = new Link(room.link(), Uint8Array.of(5, 6, 7, 8), { ...fast, maxConns: 4 })
  const accepted: number[] = []
  b.listen(conn => { accepted.push(conn.id) })
  // 4 bogus SYNs to b from a stranger fill its table (link frames are unsigned: anyone can send one)
  const injector = room.link()
  for (let i = 0; i < 4; i++) await injector.send(Uint8Array.of(0xa1, 0, 0x7f, i, 0, 0, 0, 5, 6, 7, 8, 9, 9, 9, i))
  await new Promise(r => setTimeout(r, 50))
  assert.equal(accepted.length, 4)
  const { conn } = await a.dial(Uint8Array.of(5, 6, 7, 8))
  assert.ok(conn.id !== 0x7f00)
  await conn.close()
})

