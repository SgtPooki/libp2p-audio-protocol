import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { decodeLink, encodeLink } from '../src/announce.ts'
import { modulate, Demodulator, PRESETS, type Preset } from '../src/modem.ts'
import { sealMessage } from '../src/protocol.ts'
import { JINGLES, underJingle } from '../src/jingle.ts'

test('a link announced on any preset is decoded by a guest listening on all presets at once; signed links name the sender', async () => {
  const rate = 48000
  const key = await generateKeyPair('Ed25519')
  const url = 'https://example.com/join/ABCD'
  const unsigned = encodeLink(url)
  const signed = await sealMessage(url, key)
  assert.ok(unsigned.length < 32 && signed.length > 100)
  const presets: Preset[] = ['fast', 'voice', 'ultrasonic']
  for (const sent of presets) {
    for (const bytes of [unsigned, signed]) {
      const wave = modulate(bytes, rate, PRESETS[sent])
      const heard = new Float32Array(wave.length + rate).map((_, i) => 0.3 * (wave[i - rate / 2] ?? 0) + (Math.random() - 0.5) * 0.05)
      const got: Array<{ preset: Preset, frame: Uint8Array }> = []
      const rxs = presets.map(preset => new Demodulator(rate, frame => got.push({ preset, frame }), PRESETS[preset]))
      for (let i = 0; i < heard.length; i += 4096) for (const rx of rxs) rx.push(heard.subarray(i, i + 4096))
      assert.equal(got.length, 1, `${sent}: exactly one demodulator decodes it`)
      assert.equal(got[0].preset, sent)
      const link = await decodeLink(got[0].frame)
      assert.equal(link?.url, url)
      assert.equal(link?.from?.toString(), bytes === signed ? peerIdFromPrivateKey(key).toString() : undefined)
    }
  }
  assert.equal(await decodeLink(Uint8Array.of(0xb0, 1, 2)), undefined)
})

test('a link hidden 18 dB under a public-domain jingle decodes on the hidden preset while the other presets ignore the music', async () => {
  const rate = 16000
  const url = 'https://example.com/join/ABCD'
  for (const jingle of Object.keys(JINGLES)) {
    const wave = underJingle(modulate(encodeLink(url), rate, PRESETS.hidden), JINGLES[jingle], rate, -18)
    const heard = new Float32Array(wave.length + rate).map((_, i) => 0.5 * (wave[i - rate / 2] ?? 0) + (Math.random() - 0.5) * 0.02)
    const got: Uint8Array[] = []
    const rxs = (['hidden', 'voice', 'fast'] as Preset[]).map(p => new Demodulator(rate, f => got.push(f), PRESETS[p]))
    for (let i = 0; i < heard.length; i += 4096) for (const rx of rxs) rx.push(heard.subarray(i, i + 4096))
    assert.equal(got.length, 1, `${jingle}: one decode`)
    assert.equal((await decodeLink(got[0]))?.url, url, jingle)
  }
})
