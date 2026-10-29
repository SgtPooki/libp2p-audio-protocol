import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modulate, Demodulator, MAX_PAYLOAD, PRESETS, type ModemOptions } from '../src/modem.ts'

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

test('works across sample rates, even for a max-size frame (a rounded symbol length would drift 2300 ppm)', () => {
  for (const [from, to] of [[44100, 48000], [48000, 44100]]) {
    const payload = rand(MAX_PAYLOAD - 16)
    const wave = modulate(payload, from)
    // naive linear resample
    const res = Float32Array.from({ length: Math.floor(wave.length * to / from) }, (_, i) => { const x = i * from / to; const j = Math.floor(x); return (wave[j] ?? 0) * (1 - (x - j)) + (wave[j + 1] ?? 0) * (x - j) })
    const got: Uint8Array[] = []
    const rx = new Demodulator(to, p => got.push(p))
    rx.push(room(res, 1)); rx.push(new Float32Array(to))
    assert.deepEqual(got, [payload], `${from} -> ${to}`)
  }
})

test('a max-size robust frame survives a 3000 ppm clock offset (the tail lands 2.3 symbols late)', () => {
  const payload = rand(MAX_PAYLOAD - 32)
  const wave = modulate(payload, rate, PRESETS.robust)
  const k = 1.003
  const res = Float32Array.from({ length: Math.floor(wave.length / k) }, (_, i) => { const x = i * k; const j = Math.floor(x); return (wave[j] ?? 0) * (1 - (x - j)) + (wave[j + 1] ?? 0) * (x - j) })
  const got: Uint8Array[] = []
  const rx = new Demodulator(rate, p => got.push(p), PRESETS.robust)
  for (let i = 0; i < res.length; i += 4096) rx.push(res.subarray(i, i + 4096))
  rx.push(new Float32Array(rate))
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

test('a frame whose start was lost is recovered from its tail sync and header', () => {
  for (const [where, opts] of [['sync', undefined], ['header', undefined], ['sync', PRESETS.music]] as const) {
    const payload = rand(80)
    const wave = modulate(payload, rate, opts)
    const sym = (opts?.symbolSeconds ?? 0.04) * rate
    // wipe 0.3 s starting inside the preamble or inside the header
    const from = Math.round(where === 'sync' ? 6 * sym : 10 * sym)
    wave.fill(0, from, from + Math.round(0.3 * rate))
    const got: Uint8Array[] = []
    const rx = new Demodulator(rate, p => got.push(p), opts)
    rx.push(room(wave, 1))
    rx.push(new Float32Array(rate))
    assert.deepEqual(got, [payload], `lost ${where}${opts != null ? ' (music)' : ''}`)
  }
})

test('busy() sees a tone in the band; silence and white noise are not busy', () => {
  const rx = new Demodulator(rate, () => {})
  rx.push(Float32Array.from({ length: rate }, () => (Math.random() - 0.5) * 0.2))
  assert.equal(rx.busy(), false)
  rx.push(Float32Array.from({ length: rate }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 1500 * i / rate)))
  assert.equal(rx.busy(), true)
})

test('robust round-trips through room() at 44.1k and 48k', () => {
  for (const sr of [44100, 48000]) {
    const payload = rand(60)
    const wave = modulate(payload, sr, PRESETS.robust)
    const got: Uint8Array[] = []
    const rx = new Demodulator(sr, p => got.push(p), PRESETS.robust)
    rx.push(room(Float32Array.from({ length: wave.length + sr }, (_, i) => wave[i - sr / 2] ?? 0)))
    assert.deepEqual(got, [payload], `robust @ ${sr}`)
  }
})

test('robust decodes under an equal-power colliding frame, at least as often as voice', () => {
  const sr = 16000
  const decodes = (opts: ModemOptions, seed: number): boolean => {
    let s = seed
    const r = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
    const payload = Uint8Array.from({ length: 60 }, () => Math.floor(r() * 256))
    const wave = modulate(payload, sr, opts)
    const other = modulate(Uint8Array.from({ length: 60 }, () => Math.floor(r() * 256)), sr, opts)
    const lead = sr / 2
    const sym = 0.04 * sr
    const offset = lead + Math.round(16 * sym + r() * wave.length / 2) // starts in the first half of the body
    const heard = Float32Array.from({ length: offset + other.length + sr }, (_, i) =>
      0.3 * ((wave[i - lead] ?? 0) + (other[i - offset] ?? 0)) + (r() - 0.5) * 0.02)
    const got: Uint8Array[] = []
    new Demodulator(sr, p => got.push(p), opts).push(heard)
    return got.some(p => p.length === payload.length && p.every((b, i) => b === payload[i]))
  }
  const seeds = [1, 2, 3, 4, 5]
  const robust = seeds.filter(k => decodes(PRESETS.robust, k)).length
  const voice = seeds.filter(k => decodes(PRESETS.voice, k)).length
  assert.ok(robust >= 4, `robust decoded ${robust}/5`)
  assert.ok(voice <= robust, `voice decoded ${voice}/5, robust ${robust}/5`)
})
