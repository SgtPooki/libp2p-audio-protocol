import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modulate, Demodulator, MAX_PAYLOAD, PRESETS } from '../src/modem.ts'

const rate = 48000
const rand = (n: number): Uint8Array => Uint8Array.from({ length: n }, () => Math.random() * 256)

/** Rough room: attenuation, echo, white noise, clock drift. */
function room (x: Float32Array, drift = 1.0002): Float32Array {
  const echo = Math.round(0.012 * rate)
  const out = new Float32Array(Math.floor(x.length / drift))
  for (let i = 0; i < out.length; i++) {
    const j = Math.floor(i * drift)
    out[i] = 0.2 * x[j] + 0.1 * (x[j - echo] ?? 0) + (Math.random() - 0.5) * 0.15
  }
  return out
}

test('several frames on one continuous noisy stream all decode', () => {
  const sent = [rand(1), rand(40), rand(MAX_PAYLOAD), rand(100)]
  const silence = () => Float32Array.from({ length: rate / 2 }, () => (Math.random() - 0.5) * 0.15)
  const parts = sent.flatMap(p => [silence(), room(modulate(p, rate))])
  parts.push(silence())
  const got: Uint8Array[] = []
  const rx = new Demodulator(rate, p => got.push(p))
  for (const part of parts) {
    // feed in odd-sized chunks like a mic callback would
    for (let i = 0; i < part.length; i += 1000) rx.push(part.subarray(i, i + 1000))
  }
  assert.deepEqual(got, sent)
})

test('works across sample rates', () => {
  const payload = rand(30)
  const wave = modulate(payload, 44100)
  // naive 44.1k -> 48k resample
  const up = Float32Array.from({ length: Math.floor(wave.length * 48000 / 44100) }, (_, i) => wave[Math.floor(i * 44100 / 48000)])
  const got: Uint8Array[] = []
  new Demodulator(48000, p => got.push(p)).push(room(up, 1))
  assert.deepEqual(got, [payload])
})

test('noise alone yields nothing', () => {
  const got: Uint8Array[] = []
  new Demodulator(rate, p => got.push(p)).push(Float32Array.from({ length: rate * 5 }, () => Math.random() - 0.5))
  assert.equal(got.length, 0)
})

test('survives heavy echo (real rooms skew symbol timing late)', () => {
  const payload = rand(150)
  const wave = modulate(payload, rate)
  const out = new Float32Array(wave.length + rate)
  for (let i = 0; i < out.length; i++) {
    const at = (d: number): number => wave[i - rate / 4 - Math.round(d * rate)] ?? 0
    out[i] = 0.2 * at(0) + 0.18 * at(0.006) + 0.15 * at(0.011) + 0.1 * at(0.017) + (Math.random() - 0.5) * 0.05
  }
  const got: Uint8Array[] = []
  const rx = new Demodulator(rate, p => got.push(p))
  for (let i = 0; i < out.length; i += 4096) rx.push(out.subarray(i, i + 4096))
  assert.deepEqual(got, [payload])
})

for (const [name, opts] of Object.entries(PRESETS)) {
  test(`preset ${name} round-trips through a noisy room at 44.1k and 48k`, () => {
    for (const sr of [44100, 48000]) {
      const payload = rand(60)
      const wave = modulate(payload, sr, opts)
      const heard = new Float32Array(wave.length + sr).map((_, i) => 0.3 * (wave[i - sr / 2] ?? 0) + (Math.random() - 0.5) * 0.1)
      const got: Uint8Array[] = []
      const rx = new Demodulator(sr, p => got.push(p), opts)
      for (let i = 0; i < heard.length; i += 4096) rx.push(heard.subarray(i, i + 4096))
      assert.deepEqual(got, [payload], `${name} @ ${sr}`)
    }
  })
}

test('ultrasonic data survives being mixed quietly under louder music', () => {
  const payload = rand(80)
  const data = modulate(payload, rate, PRESETS.ultrasonic)
  // "music": a wandering chord + percussion-ish noise, ~10x louder than the data
  const music = Float32Array.from({ length: data.length + rate }, (_, i) => {
    const t = i / rate
    const root = 220 * 2 ** (Math.floor(t * 2) % 4 / 12 * 3)
    return 0.3 * (Math.sin(2 * Math.PI * root * t) + Math.sin(2 * Math.PI * root * 1.25 * t) + Math.sin(2 * Math.PI * root * 1.5 * t)) / 3 +
      (i % 12000 < 600 ? (Math.random() - 0.5) * 0.6 : 0)
  })
  const mixed = music.map((m, i) => m + 0.05 * (data[i - rate / 2] ?? 0))
  const got: Uint8Array[] = []
  new Demodulator(rate, p => got.push(p), PRESETS.ultrasonic).push(mixed)
  assert.deepEqual(got, [payload])
})

test('strong late echoes (reverberant room) still decode, via differential detection', () => {
  // seeded, so the test is deterministic (it fails on the decoder without the differential pass)
  let seed = 7
  const r = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
  const payload = Uint8Array.from({ length: 100 }, () => Math.floor(r() * 256))
  const wave = modulate(payload, rate)
  const at = (i: number): number => wave[i] ?? 0
  const d = (s: number): number => Math.round(s * rate)
  // direct path plus echoes landing in the next few symbols, together louder than the direct sound
  const heard = Float32Array.from({ length: wave.length + rate }, (_, i) =>
    0.3 * (at(i) + 0.8 * at(i - d(0.035)) + 0.7 * at(i - d(0.07)) + 0.5 * at(i - d(0.11))) + (r() - 0.5) * 0.02)
  const got: Uint8Array[] = []
  const rx = new Demodulator(rate, p => got.push(p))
  for (let i = 0; i < heard.length; i += 4096) rx.push(heard.subarray(i, i + 4096))
  assert.deepEqual(got, [payload])
})

test('heavily corrupted frames are dropped, never delivered wrong (CRC after RS)', () => {
  let wrong = 0
  for (let t = 0; t < 20; t++) {
    const payload = rand(60)
    const wave = modulate(payload, rate)
    // wipe out 40% of the body with loud noise in many short bursts: far past RS capacity
    const heard = wave.map((v, i) => (i > wave.length * 0.3 && (i % 9600) < 3840) ? (Math.random() - 0.5) * 3 : v)
    new Demodulator(rate, p => { if (!p.every((b, i) => b === payload[i]) || p.length !== payload.length) wrong++ }).push(heard)
  }
  assert.equal(wrong, 0)
})
