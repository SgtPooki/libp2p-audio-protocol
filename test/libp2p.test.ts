import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { generateKeyPair } from '@libp2p/crypto/keys'
import { modulate, Demodulator } from '../src/modem.ts'
import { audio, openFrame, sealMessage, type AudioLink } from '../src/protocol.ts'

const rate = 48000

/** One shared "room": everything sent is modulated, mixed with noise, and heard by every other link. */
function air (): () => AudioLink {
  const listeners: Array<{ rx: Demodulator }> = []
  return () => {
    let cb: (f: Uint8Array) => void = () => {}
    const me = { rx: new Demodulator(rate, f => { cb(f) }) }
    listeners.push(me)
    return {
      async send (frame) {
        const wave = modulate(frame, rate)
        const heard = new Float32Array(wave.length + rate).map((_, i) => 0.3 * (wave[i - rate / 2] ?? 0) + (Math.random() - 0.5) * 0.1)
        for (const l of listeners) if (l !== me) for (let i = 0; i < heard.length; i += 2048) l.rx.push(heard.subarray(i, i + 2048))
      },
      onFrame (f) { cb = f }
    }
  }
}

test('tampered frames fail verification', async () => {
  const key = await generateKeyPair('Ed25519')
  const frame = await sealMessage('evacuate to the high school', key)
  assert.equal((await openFrame(frame))?.type, 'message')
  const bad = frame.slice()
  bad[bad.length - 70] ^= 1 // flip a bit in the payload
  assert.equal(await openFrame(bad), undefined)
})

test('peer heard over audio is discovered, dialed, and messages arrive verified', async () => {
  const room = air()
  const base = { transports: [tcp()], connectionEncrypters: [noise()], streamMuxers: [yamux()] }
  const a = await createLibp2p({ ...base, addresses: { listen: ['/ip4/127.0.0.1/tcp/0'] }, services: { audio: audio(room()) } })
  const b = await createLibp2p({ ...base, services: { audio: audio(room()) } })
  try {
    const discovered = new Promise<any>(resolve => b.addEventListener('peer:discovery', e => resolve(e.detail), { once: true }))
    await a.services.audio.announce()
    const info = await discovered
    assert.ok(info.id.equals(a.peerId))
    assert.ok(info.multiaddrs.length > 0, 'announced a listen address')

    const conn = await b.dial(a.peerId) // address came from the audio-discovered PeerRecord
    assert.equal(conn.status, 'open')

    const heard = new Promise<any>(resolve => a.services.audio.addEventListener('message', e => resolve(e.detail), { once: true }))
    await b.services.audio.say('hello from b 👋')
    const msg = await heard
    assert.equal(msg.text, 'hello from b 👋')
    assert.ok(msg.from.equals(b.peerId))
  } finally {
    await a.stop(); await b.stop()
  }
})
