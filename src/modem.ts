// MFSK-16 acoustic modem: one of 16 tones per symbol = 4 bits per symbol.
// The tone set is a preset (see PRESETS); both sides must use the same one.
//
// On-air frame:
//   preamble  [0,15]x4, 5, 10          sync; receiver matches the last 6 symbols
//   header    len, len^0xff, len       3 bytes, 6 symbols; any two that agree win (a vote)
//   body      RS(len + 4 + PARITY)      len data bytes + CRC-32 + PARITY parity bytes
//   tail      sync + header again       a receiver that missed the start locks on the tail and reads back
// Bytes are sent high nibble first.

import { rsDecode, rsEncode } from './rs.ts'
import { codedBits, convEncode, viterbi } from './conv.ts'

export const PARITY = 16 // default: corrects 8 unknown bad bytes, or up to 16 known-bad (erased) ones
const CRC = 4 // CRC-32 catches wrong corrections when erasures use up the RS redundancy
export const MAX_PAYLOAD = 255 - PARITY - CRC
/** The largest payload a preset carries: fast presets use more parity, so a dropout of a fixed length costs them nothing extra. */
export const maxPayload = (opts?: ModemOptions): number => 255 - (opts?.parity ?? PARITY) - CRC

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
function crc32 (bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function withCrc (payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + CRC)
  out.set(payload)
  new DataView(out.buffer).setUint32(payload.length, crc32(payload))
  return out
}
function checkCrc (data: Uint8Array | undefined): Uint8Array | undefined {
  if (data == null) return undefined
  const payload = data.subarray(0, data.length - CRC)
  return new DataView(data.buffer, data.byteOffset).getUint32(payload.length) === crc32(payload) ? payload.slice() : undefined
}

export interface ModemOptions {
  /** Seconds per symbol. Shorter = faster but less robust to echo. */
  symbolSeconds?: number
  /** The 16 tone frequencies in Hz. Neighbors need >= ~60 Hz spacing at 40 ms symbols. */
  tones?: number[]
  /**
   * Music mode: several 16-tone sets, one per bar; body symbols cycle through them every `barSymbols`
   * symbols (sync and header always use the first set). Each set is a chord, so the data is an arpeggio.
   */
  toneSets?: number[][]
  barSymbols?: number
  /** Dual band: `tones` has 32 entries, a low set and a high set; each symbol plays one tone from each = a byte per symbol. */
  dual?: boolean
  /** Bands per symbol (1, 2 or 3): `tones` has 16 x bands entries, one tone from each band per symbol = 4 x bands bits. `dual` = 2. */
  bands?: 1 | 2 | 3
  /** Reed-Solomon parity bytes per frame (even, 4..64). Default 16; faster presets use 32 so a 0.3 s dropout is still within reach. */
  parity?: number
  /**
   * Tone-set rotation: body symbol k uses tone set k mod rotate, the sets offset by spacing/rotate, so a tone
   * is never reused while its echo still rings. Reverb and collisions improve at no airtime cost. Default 1.
   */
  rotate?: number
  /** Pluck each symbol like a music box note instead of a continuous tone. */
  chime?: boolean
  /** Fade in/out of the whole frame, seconds. Longer hides the start/stop click (matters for ultrasonic). */
  fadeSeconds?: number
  /**
   * Soft inner code on the body: the RS codeword goes through a rate-2/3 K=7 convolutional code and a
   * frame-long interleaver, Gray-mapped onto tones, and is decoded with soft Viterbi. Survives collisions
   * that defeat hard decisions, at ~3/4 of the airtime efficiency. Single band only.
   */
  inner?: 'conv'
}

const linear = (base: number, step: number): number[] => Array.from({ length: 16 }, (_, i) => base + i * step)
// C major pentatonic, C5..C8
const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093, 2349.32, 2637.02, 3135.96, 3520, 4186.01]
/** A 7th chord's 4 notes over 4 octaves from C5 = 16 tones; semitones above C5. */
const chord = (...semis: number[]): number[] => Array.from({ length: 16 }, (_, i) => 523.25 * 2 ** ((semis[i % 4] + 12 * Math.floor(i / 4)) / 12))
/** I - V - vi - IV in C: Cmaj7, G7, Am7, Fmaj7. The loop every pop song uses. */
const PROGRESSION = [chord(0, 4, 7, 11), chord(7, 11, 2, 5), chord(9, 0, 4, 7), chord(5, 9, 0, 4)]

export const PRESETS = {
  /** 1000-2500 Hz: fits the 300-3000 Hz voice passband of walkie-talkies / FM radios. */
  voice: { tones: linear(1000, 100), rotate: 3, parity: 32 },
  /** Pentatonic music-box notes. Prettier, slower, needs a full-range speaker. */
  // alternate C and D pentatonic note to note: an echo of the last note never sits on the current one, and every
  // tone is still a scale note (together they are G major)
  chime: { tones: PENTATONIC, toneSets: [PENTATONIC, PENTATONIC.map(f => f * 2 ** (2 / 12))], barSymbols: 1, chime: true, symbolSeconds: 0.06 },
  /** 17.5-19 kHz: inaudible to most adults; mix it under music. Short range, device dependent. */
  ultrasonic: { tones: linear(17500, 100), rotate: 3, parity: 32, fadeSeconds: 0.05 },
  /** 2x voice: 20 ms symbols, 150 Hz spacing over 1000-3250 Hz. Speakers and phones, not radios (above 3 kHz). */
  /**
   * 2x voice: 20 ms symbols. Three tone sets 66.7 Hz apart (1/window) used in turn, so a tone is never
   * reused while its echo still rings: reverb and collisions improve at no airtime cost (notes/research-throughput-opus.md).
   */
  fast: { tones: linear(1000, 200), toneSets: [linear(1000, 200), linear(1000 + 200 / 3, 200), linear(1000 + 400 / 3, 200)], barSymbols: 1, symbolSeconds: 0.02, parity: 32 },
  /** 2x fast: two tones at once (1000-4100 and 4300-7400 Hz with rotation), 20 ms symbols, a byte per symbol. Speakers and phones. */
  dual: { tones: [...linear(1000, 200), ...linear(4300, 200)], dual: true, rotate: 3, symbolSeconds: 0.02, parity: 32 },
  /** 1.5x dual: three bands (700-3900, 4000-7200, 7300-10400 Hz with rotation), 12 bits per 20 ms symbol. Speakers that pass 10 kHz. */
  tri: { tones: [...linear(900, 150), ...linear(3400, 150), ...linear(5900, 150)], bands: 3, rotate: 2, symbolSeconds: 0.02, parity: 32 },
  /** 2x dual: 10 ms symbols, 267 Hz spacing, 1000-5100 + 5400-9500 Hz with rotation. Quiet rooms and short range. */
  turbo: { tones: [...linear(1000, 267), ...linear(5400, 267)], dual: true, rotate: 2, symbolSeconds: 0.01, parity: 32 },
  /** 4-7 kHz, 200 Hz apart, 30 ms symbols: above most melody energy, so it can hide under a jingle (see src/jingle.ts). */
  hidden: { tones: linear(4000, 200), rotate: 3, symbolSeconds: 0.03, parity: 32 },
  /** Sounds like an arpeggiator: plucked chord tones, the chord changes every 8 notes through I-V-vi-IV. Same speed as chime. */
  music: { tones: PROGRESSION[0], toneSets: PROGRESSION, barSymbols: 8, chime: true, symbolSeconds: 0.06 },
  /** voice's band with a soft convolutional inner code: survives an equal-power colliding sender. */
  robust: { tones: linear(1000, 100), rotate: 3, symbolSeconds: 0.04, parity: 32, inner: 'conv' }
} satisfies Record<string, ModemOptions>
export type Preset = keyof typeof PRESETS

const PREAMBLE = [0, 15, 0, 15, 0, 15, 0, 15, 5, 10]
const SYNC = PREAMBLE.slice(-6)
const HDR_BYTES = 3
const HOPS = 8 // detection resolution: hops per symbol
const CHASE = 8 // bytes whose runner-up tone is tried when Reed-Solomon fails
const header = (len: number): Uint8Array => Uint8Array.of(len, len ^ 0xff, len)

/**
 * bands: tones played at once, one per 16-tone set; a symbol carries 4 x bands bits. `symbols(bytes)` is how
 * many symbols n bytes take (2 per byte with one band, 1 with two, 2 per 3 bytes with three).
 */
/** sets: tone sets laid out [band * rotate + rotation]; rotate = sets per band. */
/** body(n): symbols an n-byte RS codeword takes on air (more with the inner code). */
interface Config { sym: number, hop: number, sets: number[][], bar: number, sampleRate: number, bands: number, rotate: number, bits: number, hdr: number, tail: number, symbols: (bytes: number) => number, body: (bytes: number) => number, inner: boolean, parity: number, max: number, win: number }

function config (sampleRate: number, opts: ModemOptions = {}): Config {
  // rotation changes tone set every symbol; music changes chord every bar of 8
  const { symbolSeconds = 0.04, tones = PRESETS.voice.tones, barSymbols = opts.toneSets != null ? 8 : 1 } = opts
  const bands = opts.bands ?? (opts.dual === true ? 2 : 1)
  let toneSets: number[][]
  let rotate: number
  if (opts.toneSets != null) { toneSets = opts.toneSets; rotate = toneSets.length } else {
    rotate = opts.rotate ?? 1
    const base = Array.from({ length: bands }, (_, b) => tones.slice(16 * b, 16 * b + 16))
    toneSets = base.flatMap(set => Array.from({ length: rotate }, (_, r) => set.map(f => f + r * (set[1] - set[0]) / rotate)))
  }
  if (toneSets.some(t => t.length !== 16) || toneSets.length !== bands * rotate) throw new RangeError('need exactly 16 tones per set')
  // exact symbol period in samples, fractional: rounding it to whole samples would make a 44.1 kHz and a
  // 48 kHz device disagree by up to 2300 ppm, over a symbol per max-size frame
  const sym = symbolSeconds * sampleRate
  const hop = sym / HOPS
  const bits = 4 * bands
  const symbols = (bytes: number): number => Math.ceil(8 * bytes / bits)
  const parity = opts.parity ?? PARITY
  if (parity % 2 !== 0 || parity < 4 || parity > 64) throw new RangeError('parity must be even, 4..64')
  const inner = opts.inner === 'conv'
  if (inner && bands > 1) throw new RangeError('inner code supports single-band presets only')
  const body = (bytes: number): number => inner ? Math.ceil(codedBits(8 * bytes) / 4) : symbols(bytes)
  // Goertzel window: the middle 3/4 of the symbol (the first 1/8 is where room reflections arrive, the last
  // 1/8 guards a late timing estimate). ponytail: a window that is a whole number of tone-spacing periods
  // cuts neighbour leakage (collisions +15-20 points) but is shorter and costs ~1 dB of SNR margin; measured
  // as a net loss at -6 dB, so not used.
  const win = Math.round(sym * 3 / 4)
  return { sym, hop, sets: toneSets, bar: barSymbols, sampleRate, bands, rotate, bits, hdr: symbols(HDR_BYTES), tail: SYNC.length + symbols(HDR_BYTES), symbols, body, inner, parity, max: 255 - parity - CRC, win }
}

/** The tone set band `b` uses for body symbol `k` (0-based from the body start); sync and header use rotation 0. */
const setFor = (c: Config, k: number, b = 0): number => b * c.rotate + Math.floor(k / c.bar) % c.rotate

/** Pack bytes into symbols of `c.bits` bits, most significant first (the last symbol is zero-padded). */
function toSymbols (bytes: Uint8Array, c: Config): number[] {
  const out: number[] = []
  let acc = 0; let n = 0
  for (const b of bytes) {
    acc = (acc << 8) | b; n += 8
    while (n >= c.bits) { n -= c.bits; out.push((acc >> n) & ((1 << c.bits) - 1)); acc &= (1 << n) - 1 }
  }
  if (n > 0) out.push((acc << (c.bits - n)) & ((1 << c.bits) - 1))
  return out
}

/** Unpack symbols of `c.bits` bits into `count` bytes. */
function fromSymbols (symbols: number[], count: number, c: Config): Uint8Array {
  const out = new Uint8Array(count)
  let acc = 0; let n = 0; let i = 0
  for (const s of symbols) {
    acc = (acc << c.bits) | s; n += c.bits
    while (n >= 8 && i < count) { n -= 8; out[i++] = (acc >> n) & 0xff; acc &= (1 << n) - 1 }
  }
  return out
}

// Inner code: tone index = Gray code of the 4-bit symbol value, so a neighbouring tone costs one bit
const GRAY = Array.from({ length: 16 }, (_, s) => s ^ (s >> 1))
const UNGRAY = GRAY.map((_, t) => GRAY.indexOf(t))

/** Row-column interleaver over n bits: order[j] = the coded bit sent at position j (width ~sqrt(n)). */
function interleaver (n: number): number[] {
  const w = Math.ceil(Math.sqrt(n))
  return Array.from({ length: n }, (_, i) => i).sort((a, b) => (a % w) - (b % w) || a - b)
}

/** Inner-coded body: codeword bits -> conv code -> interleave -> 4-bit Gray-mapped tone indices. */
function innerSymbols (cw: Uint8Array): number[] {
  const bits = Array.from({ length: 8 * cw.length }, (_, i) => (cw[i >> 3] >> (7 - (i & 7))) & 1)
  const coded = convEncode(bits)
  const order = interleaver(coded.length)
  return Array.from({ length: Math.ceil(coded.length / 4) }, (_, k) => {
    let s = 0
    for (let b = 0; b < 4; b++) s = (s << 1) | (coded[order[4 * k + b]] ?? 0)
    return GRAY[s]
  })
}

/** The nibble band `b` of symbol `s` plays (band 0 = the lowest 4 bits). */
const nibble = (s: number, b: number, c: Config): number => (s >> (4 * (c.bands - 1 - b))) & 15

/** Encode a payload into mono float samples at `sampleRate`. */
export function modulate (payload: Uint8Array, sampleRate: number, opts?: ModemOptions): Float32Array {
  const c = config(sampleRate, opts)
  if (payload.length === 0 || payload.length > c.max) throw new RangeError(`payload must be 1..${c.max} bytes`)
  const hdr = toSymbols(header(payload.length), c)
  const cw = rsEncode(withCrc(payload), c.parity)
  const body = c.inner ? innerSymbols(cw) : toSymbols(cw, c)
  // sync symbols are < 16: in dual mode they play the same index on both sets
  const symbols = [...PREAMBLE, ...hdr, ...body, ...SYNC, ...hdr]
  const bodyAt = PREAMBLE.length + hdr.length
  const at = (i: number): number => Math.round(i * c.sym) // sample where symbol i starts
  const out = new Float32Array(at(symbols.length))
  const attack = Math.round(0.004 * sampleRate)
  const phases = c.sets.map(() => 0) // continuous phase per band avoids clicks between symbols
  symbols.forEach((s, i) => {
    const k = i - bodyAt
    const inBody = k >= 0 && k < body.length
    const isSync = i < PREAMBLE.length || (k >= body.length && k < body.length + SYNC.length)
    // several bands: each band plays its nibble of the symbol; sync/header symbols play the same index on every band
    const tones = c.bands > 1
      ? Array.from({ length: c.bands }, (_, b) => c.sets[inBody ? setFor(c, k, b) : b * c.rotate][isSync ? s : nibble(s, b, c)])
      : [c.sets[inBody ? setFor(c, k) : 0][s]]
    const amp = 0.8 / tones.length
    tones.forEach((f, t) => {
      const step = 2 * Math.PI * f / sampleRate
      const edge = Math.round(c.sym / 16) // raised-cosine edges, inside the 1/8 the receiver skips: no clicks between tones
      for (let n = at(i); n < at(i + 1); n++) {
        const k = n - at(i); const left = at(i + 1) - 1 - n
        const smooth = k < edge ? 0.5 * (1 - Math.cos(Math.PI * k / edge)) : left < edge ? 0.5 * (1 - Math.cos(Math.PI * left / edge)) : 1
        // chime: quick attack, then decay to ~35% by the end of the note
        const env = (opts?.chime === true ? Math.min(1, k / attack) * Math.exp(-k / c.sym) : 1) * smooth
        out[n] += amp * env * Math.sin(phases[t])
        phases[t] += step
      }
    })
  })
  const fade = Math.round((opts?.fadeSeconds ?? 0.005) * sampleRate)
  for (let n = 0; n < fade; n++) {
    out[n] *= n / fade
    out[out.length - 1 - n] *= n / fade
  }
  return out
}

/**
 * Streaming demodulator. Feed it microphone samples with `push`; it calls
 * `onFrame` with every payload that passes Reed-Solomon decoding.
 */
export class Demodulator {
  private readonly c: Config
  private buf = new Float32Array(0)
  private bufStart = 0 // absolute sample index of buf[0]
  private scan = 0 // absolute sample index of next sync candidate
  private coefs: number[][]
  private energies = new Map<number, Float64Array>() // window start * sets + set -> tone energies
  private readonly onFrame: (payload: Uint8Array) => void

  constructor (sampleRate: number, onFrame: (payload: Uint8Array) => void, opts?: ModemOptions) {
    this.onFrame = onFrame
    this.c = config(sampleRate, opts)
    this.period = this.c.sym
    this.coefs = this.coefsFor(1)
  }

  push (samples: Float32Array): void {
    const next = new Float32Array(this.buf.length + samples.length)
    next.set(this.buf)
    next.set(samples, this.buf.length)
    this.buf = next
    this.process()
    // keep enough audio to read the longest possible frame backwards from its tail, plus a margin
    const longest = (PREAMBLE.length + this.c.hdr + this.c.body(255) + this.c.tail) * this.c.sym
    const keepFrom = Math.floor(Math.min(this.scan - this.c.sym, this.bufStart + this.buf.length - longest - 2 * this.c.sampleRate))
    if (keepFrom > this.bufStart) {
      this.buf = this.buf.slice(keepFrom - this.bufStart)
      this.bufStart = keepFrom
      for (const k of this.energies.keys()) if (k < keepFrom * this.c.sets.length) this.energies.delete(k)
    }
  }

  private get end (): number { return this.bufStart + this.buf.length }

  /** Seconds of audio still to play of the last frame we decoded (its tail copy), or 0. An answer can start right after it. */
  tailLeft (): number {
    return Math.max(0, (this.lastTailEnd - this.end) / this.c.sampleRate)
  }

  private lastTailEnd = 0

  /** Is one tone dominating the band in the latest symbol? Someone is transmitting: listen before you talk. */
  busy (): boolean {
    const start = Math.floor(this.end - this.c.sym)
    if (start < this.bufStart) return false
    const e = this.tonesAt(start)
    let max = 0; let total = 1e-12
    for (const v of e) { total += v; if (v > max) max = v }
    return max / total > 0.5
  }

  /** Goertzel coefficients for the tone sets, with every frequency divided by `scale` (a stretched clock also lowers the pitch). */
  private coefsFor (scale: number): number[][] {
    return this.c.sets.map(set => set.map(f => 2 * Math.cos(2 * Math.PI * f / scale / this.c.sampleRate)))
  }

  /** Goertzel energies of the 16 tones of `set` over the last `win` samples of the symbol starting at `start`. */
  private tonesAt (start: number, set = 0): Float64Array {
    start = Math.round(start)
    const key = start * this.c.sets.length + set
    let e = this.energies.get(key)
    if (e != null) return e
    const from = Math.round(start + this.c.sym * 7 / 8 - this.c.win) - this.bufStart
    const len = this.c.win
    e = new Float64Array(16)
    for (let t = 0; t < 16; t++) e[t] = this.goertzel(from, len, this.coefs[set][t])
    this.energies.set(key, e)
    return e
  }

  private goertzel (from: number, len: number, k: number): number {
    let s1 = 0; let s2 = 0
    for (let n = from; n < from + len; n++) {
      const s0 = this.buf[n] + k * s1 - s2
      s2 = s1; s1 = s0
    }
    return s1 * s1 + s2 * s2 - k * s1 * s2
  }

  /**
   * Pitch scale of the sync at `start`: the scale in 1 +- 4000 ppm (1000 ppm steps) that puts the most energy on the
   * sync tones. A receiver clock or Doppler shift stretches pitch and time together; 3000 ppm moves ultrasonic tones
   * by half a bin, where the nominal detector reads the header wrong.
   */
  private pitchScaleAt (start: number): number {
    const { sym, win, sampleRate } = this.c
    let best = 1; let bestE = -1
    for (let i = -4; i <= 4; i++) {
      const scale = 1 + i / 1000 // i = 0 is exactly 1: no retune, keep the energies cache
      let e = 0
      for (let i = 0; i < SYNC.length; i++) {
        const from = Math.round(start + i * sym + sym * 7 / 8 - win) - this.bufStart
        e += this.goertzel(from, win, 2 * Math.cos(2 * Math.PI * this.c.sets[0][SYNC[i]] / scale / sampleRate))
      }
      if (e > bestE) { bestE = e; best = scale }
    }
    return best
  }

  /**
   * Per-tone scores for the symbol at `start`. Differential mode subtracts half of the previous
   * symbol's energy: in a reverberant room the echo of the last tone decays while the new tone
   * doesn't, so this undoes most echo smear (RT60 0.3 s: ~20% -> ~75% frames in the scorecard).
   */
  private scoresAt (start: number, diff: boolean, set = 0): Float64Array {
    const e = this.tonesAt(start, set)
    if (!diff) return e
    // ponytail: one tap. A second tap (0.25 x the symbol before) measured +3 points on voice reverb, inside the noise.
    const prev = this.tonesAt(start - this.c.sym, set)
    return e.map((v, t) => v - 0.5 * prev[t])
  }

  private symbolAt (start: number, diff = false, set = 0): number {
    const e = this.scoresAt(Math.round(start), diff, set)
    let best = 0
    for (let t = 1; t < 16; t++) if (e[t] > e[best]) best = t
    return best
  }

  /** The second-best tone at `start`: in reverb and collisions it is usually the right one when the best is wrong. */
  private runnerUpAt (start: number, diff: boolean, set: number): number {
    const e = this.scoresAt(Math.round(start), diff, set)
    let best = 0; let second = -1
    for (let t = 1; t < 16; t++) if (e[t] > e[best]) { second = best; best = t } else if (second < 0 || e[t] > e[second]) second = t
    return second < 0 ? 0 : second
  }

  /** Byte `i` of a body at `start` with its weakest nibble replaced by that nibble's runner-up tone. */
  private altByte (start: number, i: number, diff: boolean, current: number): number {
    const c = this.c
    let weakBit = 8 * i; let weakConf = Infinity
    for (const bit of [8 * i, 8 * i + 4]) {
      const k = Math.floor(bit / c.bits); const b = Math.floor((bit % c.bits) / 4)
      const conf = this.confidenceAt(start + k * this.period, diff, setFor(c, k, b))
      if (conf < weakConf) { weakConf = conf; weakBit = bit }
    }
    const k = Math.floor(weakBit / c.bits); const b = Math.floor((weakBit % c.bits) / 4)
    const alt = this.runnerUpAt(start + k * this.period, diff, setFor(c, k, b))
    // the high nibble of the byte is the first of its two 4-bit slots
    return weakBit === 8 * i ? (alt << 4) | (current & 15) : (current & 0xf0) | alt
  }

  /** How well the sync pattern matches if the sync starts at `start` (0..1). */
  private syncScore (start: number): number {
    let score = 0
    let misses = 0
    for (let i = 0; i < SYNC.length; i++) {
      const e = this.tonesAt(start + i * this.c.sym)
      let total = 1e-12
      for (const v of e) total += v
      // tolerate one bad sync symbol (a cough, a door); the header check and RS reject false syncs
      if (this.symbolAt(start + i * this.c.sym) !== SYNC[i] && ++misses > 1) return 0
      score += e[SYNC[i]] / total
    }
    return score / SYNC.length
  }

  /** The full symbol (all bands) at `start`. */
  private wholeSymbolAt (start: number, diff: boolean, k: number, body: boolean): number {
    const c = this.c
    if (c.bands === 1) return this.symbolAt(start, diff, body ? setFor(c, k) : 0)
    let s = 0
    for (let b = 0; b < c.bands; b++) s = (s << 4) | this.symbolAt(start, diff, body ? setFor(c, k, b) : b * c.rotate)
    return s
  }

  /** `body` = true: these are body symbols (tone set cycles per bar in music mode). */
  private bytesAt (start: number, n: number, diff = false, body = false): Uint8Array {
    const c = this.c
    const count = c.symbols(n)
    const symbols = Array.from({ length: count }, (_, k) => this.wholeSymbolAt(start + k * this.period, diff, k, body))
    return fromSymbols(symbols, n, c)
  }

  /** Confidence of byte `i` of a body at `start`: the weakest symbol/band it spans. */
  private byteConfidence (start: number, i: number, diff: boolean): number {
    const c = this.c
    let conf = Infinity
    // the byte's two nibbles: each lives in one (symbol, band); a band is 4 bits, band 0 is the top nibble of a symbol
    for (const bit of [8 * i, 8 * i + 4]) {
      const k = Math.floor(bit / c.bits)
      const b = Math.floor((bit % c.bits) / 4)
      conf = Math.min(conf, this.confidenceAt(start + k * this.period, diff, setFor(c, k, b)))
    }
    return conf
  }

  /** How sure we are of the symbol at `start`: margin of the best score over the runner-up, relative to total energy. */
  private confidenceAt (start: number, diff: boolean, set: number): number {
    const s = [...this.scoresAt(start, diff, set)].sort((a, b) => b - a)
    let total = 1e-12
    for (const v of this.tonesAt(start, set)) total += v
    // a symbol far quieter than the ones around it is a dropout: don't let noise in the gap look confident
    let around = 1e-12
    for (const d of [-2, -1, 1, 2]) { const o = Math.round(start + d * this.c.sym); if (o >= this.bufStart && o + this.c.sym <= this.end) for (const v of this.tonesAt(o, set)) around += v }
    return (s[0] - s[1]) / (total + 0.15 * around / 4)
  }

  /**
   * RS-decode n bytes at `start`. If that fails, retry with the least confident bytes marked as
   * erasures (RS fixes 16 erasures but only 8 unknown errors), then repeat both with differential
   * detection for echoey rooms. Plain detection goes first, so quiet-room results never get worse;
   * the CRC rejects any wrong correction.
   */
  private decodeBody (start: number, n: number): Uint8Array | undefined {
    if (this.c.inner) return this.decodeInner(start, n)
    for (const diff of [false, true]) {
      const cw = this.bytesAt(start, n, diff, true)
      const plain = checkCrc(rsDecode(cw, this.c.parity))
      if (plain != null) return plain
      const conf = Array.from({ length: n }, (_, i) => this.byteConfidence(start, i, diff))
      const weakest = conf.map((c, i) => [c, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i)
      for (let k = 4; k <= this.c.parity; k += 4) {
        const payload = checkCrc(rsDecode(cw, this.c.parity, weakest.slice(0, k)))
        if (payload != null) return payload
      }
      // Chase-style: swap the weakest bytes one at a time for their runner-up reading, erase the next-weakest
      for (const i of weakest.slice(0, CHASE)) {
        const alt = cw.slice()
        alt[i] = this.altByte(start, i, diff, cw[i])
        if (alt[i] === cw[i]) continue
        for (const k of [0, Math.min(this.c.parity, 8)]) {
          const payload = checkCrc(rsDecode(alt, this.c.parity, weakest.filter(j => j !== i).slice(0, k)))
          if (payload != null) return payload
        }
      }
    }
    return undefined
  }

  /**
   * Inner-coded body: per-bit max-log LLRs from the tone scores (FT8's demapper), de-interleave, soft
   * Viterbi, then RS + CRC. Plain detection first, then differential, as in the hard path.
   */
  private decodeInner (start: number, n: number): Uint8Array | undefined {
    const c = this.c
    const nbits = codedBits(8 * n)
    const order = interleaver(nbits)
    const llr = new Float64Array(nbits)
    for (const diff of [false, true]) {
      for (let k = 0; k < c.body(n); k++) {
        const at = Math.round(start + k * this.period)
        const set = setFor(c, k)
        const e = this.scoresAt(at, diff, set)
        let total = 1e-12
        for (const v of this.tonesAt(at, set)) total += v
        for (let b = 0; b < 4 && 4 * k + b < nbits; b++) {
          let one = -Infinity; let zero = -Infinity
          for (let t = 0; t < 16; t++) {
            if ((UNGRAY[t] >> (3 - b)) & 1) one = Math.max(one, e[t]); else zero = Math.max(zero, e[t])
          }
          llr[order[4 * k + b]] = (one - zero) / total
        }
      }
      const bits = viterbi(llr, 8 * n)
      const cw = new Uint8Array(n)
      for (let i = 0; i < 8 * n; i++) cw[i >> 3] |= bits[i] << (7 - (i & 7))
      const payload = checkCrc(rsDecode(cw, c.parity))
      if (payload != null) return payload
    }
    return undefined
  }

  /** The length from the 3-copy header at `start`, if two copies agree and it is sane. */
  private lengthAt (start: number): number | undefined {
    for (const diff of [false, true]) {
      const [a, b, c] = this.bytesAt(start, 3, diff)
      const votes = [a, b ^ 0xff, c]
      const len = votes.find(v => votes.filter(w => w === v).length >= 2)
      if (len != null && len !== 0 && len <= this.c.max) return len
    }
    return undefined
  }

  private process (): void {
    const { sym, hop } = this.c
    const syncLen = SYNC.length * sym
    this.flushPending()
    // need room to refine alignment up to one symbol past the first hit
    while (this.scan + syncLen + sym <= this.end) {
      if (this.syncScore(this.scan) < 0.4) { this.scan += hop; continue }

      // Sync matches over a range of offsets, and room echo skews that range late,
      // so try every offset from a bit before the first match to the last match
      // and keep the first one whose Reed-Solomon check passes. Each offset is read
      // both as a frame head (body follows) and as a frame tail (body precedes).
      let last = this.scan
      while (last + hop < this.scan + sym && this.syncScore(last + hop) >= 0.4) last += hop
      const heads: Array<{ body: number, len: number }> = []
      const tails: Array<{ body: number, len: number, end: number }> = []
      for (let s = Math.max(this.bufStart, this.scan - sym / 4); s <= last; s += hop) {
        const header = s + syncLen
        const { hdr } = this.c
        if (header + hdr * sym > this.end) return // wait for header
        const len = this.lengthAt(header)
        if (len == null) continue
        const bodyLen = this.c.body(len + CRC + this.c.parity) * sym
        if (!heads.some(f => f.body === header + hdr * sym && f.len === len)) heads.push({ body: header + hdr * sym, len })
        if (s - bodyLen >= this.bufStart && !this.wasDecoded(s - bodyLen) && !tails.some(f => f.body === s - bodyLen && f.len === len)) {
          tails.push({ body: s - bodyLen, len, end: header + hdr * sym })
        }
      }
      let decoded = false
      for (const { body, len, end } of tails) {
        const payload = this.decodeBody(body, len + CRC + this.c.parity)
        if (payload == null) continue
        this.markDecoded(body)
        this.scan = Math.max(this.scan, end)
        this.onFrame(payload)
        decoded = true
        break
      }
      if (decoded) continue
      for (const { body, len } of heads) {
        const bodyEnd = body + this.c.body(len + CRC + this.c.parity) * sym
        // body still on its way: remember it and keep scanning, so a phantom length can't stall the receiver
        if (bodyEnd > this.end) { if (this.pending.length < 64) this.pending.push({ body, len }); continue }
        if (this.tryHead(body, len)) { decoded = true; break }
      }
      if (decoded) continue
      this.scan = last + hop
    }
  }

  /**
   * Decode a body at nominal timing. If that fails and the frame's tail has arrived, measure what the channel did
   * to the frame and decode once more: pitch scale from the head sync (retunes the detector, re-reads the length),
   * symbol period from the head-to-tail sync distance (3000 ppm slips a 20 s frame by a symbol). Nothing changes on
   * the common path.
   */
  private tryHead (body: number, len: number, retry = false): boolean {
    let n = len + CRC + this.c.parity
    let payload = retry ? undefined : this.decodeBody(body, n)
    if (payload == null) {
      const { sym, hop, hdr } = this.c
      const headSync = body - hdr * sym - SYNC.length * sym
      // the tail is searched over +-4000 ppm of the frame (at least a symbol); every window of that search must be buffered
      const span = (expectTail: number): number => Math.max(sym, 0.004 * (expectTail - headSync))
      const ready = (expectTail: number): boolean => expectTail + span(expectTail) + SYNC.length * sym <= this.end
      const wait = (len: number): false => { if (this.pending.length < 64) this.pending.push({ body, len, retry: true }); return false }
      if (!ready(body + this.c.body(n) * sym)) return wait(len)
      const saved = { coefs: this.coefs, energies: this.energies }
      try {
        const pitch = this.pitchScaleAt(headSync)
        if (pitch !== 1) {
          this.coefs = this.coefsFor(pitch); this.energies = new Map()
          const fixed = this.lengthAt(body - hdr * sym)
          if (fixed == null) return false
          len = fixed; n = len + CRC + this.c.parity
        }
        // find the tail sync near where it should be, then scale the period by where it actually is
        const expectTail = body + this.c.body(n) * sym
        if (!ready(expectTail)) return wait(len)
        let best = expectTail; let bestScore = 0
        for (let s = expectTail - span(expectTail); s <= expectTail + span(expectTail); s += hop / 2) { const sc = this.syncScore(s); if (sc > bestScore) { bestScore = sc; best = s } }
        if (bestScore < 0.4) return false
        this.period = sym * (best - headSync) / (expectTail - headSync)
        payload = this.decodeBody(body, n)
      } finally { this.period = this.c.sym; this.coefs = saved.coefs; this.energies = saved.energies }
      if (payload == null) return false
    }
    this.markDecoded(body)
    this.lastTailEnd = body + this.c.body(n) * this.c.sym + this.c.tail * this.c.sym
    // keep scanning from just after this frame's header: another sender's frame may overlap this one and
    // its sync must still be found (a decoded body start is remembered so its tail doesn't deliver it twice)
    this.scan = Math.max(this.scan, body)
    this.pending = this.pending.filter(p => !this.wasDecoded(p.body))
    this.onFrame(payload)
    return true
  }

  /** Decode remembered frame heads whose bodies have now fully arrived. */
  private flushPending (): void {
    const sym = this.c.sym
    for (const p of this.pending.splice(0)) {
      if (this.wasDecoded(p.body)) continue
      if (p.body + this.c.body(p.len + CRC + this.c.parity) * sym > this.end) { this.pending.push(p); continue }
      this.tryHead(p.body, p.len, p.retry)
    }
  }

  /** Frame heads waiting for their body; `retry`: body failed once, decode again with the tail-measured period. */
  private pending: Array<{ body: number, len: number, retry?: boolean }> = []
  /** Symbol period used for body positions: nominal, or measured from the frame's own head and tail syncs. */
  private period = 0
  // body starts already delivered (a frame's head and tail must deliver it once); not a barrier, so a frame
  // that overlaps an already decoded one (a collision) can still be found and decoded
  private readonly done: number[] = []
  private wasDecoded (body: number): boolean { return this.done.some(d => Math.abs(d - body) < 2 * this.c.sym) }
  private markDecoded (body: number): void { this.done.push(body); if (this.done.length > 32) this.done.shift() }
}
