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
  voice: { tones: linear(1000, 100), parity: 32 },
  /** Pentatonic music-box notes. Prettier, slower, needs a full-range speaker. */
  chime: { tones: PENTATONIC, chime: true, symbolSeconds: 0.06 },
  /** 17.5-19 kHz: inaudible to most adults; mix it under music. Short range, device dependent. */
  ultrasonic: { tones: linear(17500, 100), fadeSeconds: 0.05 },
  /** 2x voice: 20 ms symbols, 150 Hz spacing over 1000-3250 Hz. Speakers and phones, not radios (above 3 kHz). */
  /**
   * 2x voice: 20 ms symbols. Three tone sets 66.7 Hz apart (1/window) used in turn, so a tone is never
   * reused while its echo still rings: reverb and collisions improve at no airtime cost (notes/research-throughput-opus.md).
   */
  fast: { tones: linear(1000, 200), toneSets: [linear(1000, 200), linear(1000 + 200 / 3, 200), linear(1000 + 400 / 3, 200)], barSymbols: 1, symbolSeconds: 0.02, parity: 32 },
  /** 2x fast: two tones at once (1000-3250 Hz and 4000-6250 Hz), 20 ms symbols, a byte per symbol. Speakers and phones. */
  dual: { tones: [...linear(1000, 200), ...linear(4300, 200)], dual: true, rotate: 3, symbolSeconds: 0.02, parity: 32 },
  /** 1.5x dual: three bands (700-2950, 3200-5450, 5700-7950 Hz), 12 bits per 20 ms symbol. Speakers and phones. */
  tri: { tones: [...linear(700, 200), ...linear(4000, 200), ...linear(7300, 200)], bands: 3, rotate: 3, symbolSeconds: 0.02, parity: 32 },
  /** 2x dual: 10 ms symbols, 200 Hz spacing, 1000-4000 + 4200-7200 Hz. Quiet rooms and short range. */
  turbo: { tones: [...linear(1000, 267), ...linear(5400, 267)], dual: true, rotate: 2, symbolSeconds: 0.01, parity: 32 },
  /** 4-7 kHz, 200 Hz apart, 30 ms symbols: above most melody energy, so it can hide under a jingle (see src/jingle.ts). */
  hidden: { tones: linear(4000, 200), symbolSeconds: 0.03 },
  /** Sounds like an arpeggiator: plucked chord tones, the chord changes every 8 notes through I-V-vi-IV. Same speed as chime. */
  music: { tones: PROGRESSION[0], toneSets: PROGRESSION, barSymbols: 8, chime: true, symbolSeconds: 0.06 }
} satisfies Record<string, ModemOptions>
export type Preset = keyof typeof PRESETS

const PREAMBLE = [0, 15, 0, 15, 0, 15, 0, 15, 5, 10]
const SYNC = PREAMBLE.slice(-6)
const HDR_BYTES = 3
const HOPS = 8 // detection resolution: hops per symbol
const header = (len: number): Uint8Array => Uint8Array.of(len, len ^ 0xff, len)

/**
 * bands: tones played at once, one per 16-tone set; a symbol carries 4 x bands bits. `symbols(bytes)` is how
 * many symbols n bytes take (2 per byte with one band, 1 with two, 2 per 3 bytes with three).
 */
/** sets: tone sets laid out [band * rotate + rotation]; rotate = sets per band. */
interface Config { sym: number, hop: number, sets: number[][], bar: number, sampleRate: number, bands: number, rotate: number, bits: number, hdr: number, tail: number, symbols: (bytes: number) => number, parity: number, max: number, win: number }

function config (sampleRate: number, opts: ModemOptions = {}): Config {
  const { symbolSeconds = 0.04, tones = PRESETS.voice.tones, barSymbols = 8 } = opts
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
  // Goertzel window: the middle 3/4 of the symbol (the first 1/8 is where room reflections arrive, the last
  // 1/8 guards a late timing estimate). ponytail: a window that is a whole number of tone-spacing periods
  // cuts neighbour leakage (collisions +15-20 points) but is shorter and costs ~1 dB of SNR margin; measured
  // as a net loss at -6 dB, so not used.
  const win = Math.round(sym * 3 / 4)
  return { sym, hop, sets: toneSets, bar: barSymbols, sampleRate, bands, rotate, bits, hdr: symbols(HDR_BYTES), tail: SYNC.length + symbols(HDR_BYTES), symbols, parity, max: 255 - parity - CRC, win }
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

/** The nibble band `b` of symbol `s` plays (band 0 = the lowest 4 bits). */
const nibble = (s: number, b: number, c: Config): number => (s >> (4 * (c.bands - 1 - b))) & 15

/** Encode a payload into mono float samples at `sampleRate`. */
export function modulate (payload: Uint8Array, sampleRate: number, opts?: ModemOptions): Float32Array {
  const c = config(sampleRate, opts)
  if (payload.length === 0 || payload.length > c.max) throw new RangeError(`payload must be 1..${c.max} bytes`)
  const hdr = toSymbols(header(payload.length), c)
  const body = toSymbols(rsEncode(withCrc(payload), c.parity), c)
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
      for (let n = at(i); n < at(i + 1); n++) {
        // chime: quick attack, then decay to ~35% by the end of the note
        const env = opts?.chime === true ? Math.min(1, (n - at(i)) / attack) * Math.exp(-(n - at(i)) / c.sym) : 1
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
  private readonly energies = new Map<number, Float64Array>() // window start * sets + set -> tone energies
  private readonly coefs: number[][]
  private readonly onFrame: (payload: Uint8Array) => void

  constructor (sampleRate: number, onFrame: (payload: Uint8Array) => void, opts?: ModemOptions) {
    this.onFrame = onFrame
    this.c = config(sampleRate, opts)
    this.coefs = this.c.sets.map(set => set.map(f => 2 * Math.cos(2 * Math.PI * f / sampleRate)))
  }

  push (samples: Float32Array): void {
    const next = new Float32Array(this.buf.length + samples.length)
    next.set(this.buf)
    next.set(samples, this.buf.length)
    this.buf = next
    this.process()
    // keep enough audio to read the longest possible frame backwards from its tail, plus a margin
    const longest = (PREAMBLE.length + this.c.hdr + this.c.symbols(255) + this.c.tail) * this.c.sym
    const keepFrom = Math.floor(Math.min(this.scan - this.c.sym, this.bufStart + this.buf.length - longest - 2 * this.c.sampleRate))
    if (keepFrom > this.bufStart) {
      this.buf = this.buf.slice(keepFrom - this.bufStart)
      this.bufStart = keepFrom
      for (const k of this.energies.keys()) if (k < keepFrom * this.c.sets.length) this.energies.delete(k)
    }
  }

  private get end (): number { return this.bufStart + this.buf.length }

  /** Is one tone dominating the band in the latest symbol? Someone is transmitting: listen before you talk. */
  busy (): boolean {
    const start = Math.floor(this.end - this.c.sym)
    if (start < this.bufStart) return false
    const e = this.tonesAt(start)
    let max = 0; let total = 1e-12
    for (const v of e) { total += v; if (v > max) max = v }
    return max / total > 0.5
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
    for (let t = 0; t < 16; t++) {
      const k = this.coefs[set][t]
      let s1 = 0; let s2 = 0
      for (let n = from; n < from + len; n++) {
        const s0 = this.buf[n] + k * s1 - s2
        s2 = s1; s1 = s0
      }
      e[t] = s1 * s1 + s2 * s2 - k * s1 * s2
    }
    this.energies.set(key, e)
    return e
  }

  /**
   * Per-tone scores for the symbol at `start`. Differential mode subtracts half of the previous
   * symbol's energy: in a reverberant room the echo of the last tone decays while the new tone
   * doesn't, so this undoes most echo smear (RT60 0.3 s: ~20% -> ~75% frames in the scorecard).
   */
  private scoresAt (start: number, diff: boolean, set = 0): Float64Array {
    const e = this.tonesAt(start, set)
    if (!diff) return e
    const prev = this.tonesAt(start - this.c.sym, set)
    return e.map((v, t) => v - 0.5 * prev[t])
  }

  private symbolAt (start: number, diff = false, set = 0): number {
    const e = this.scoresAt(Math.round(start), diff, set)
    let best = 0
    for (let t = 1; t < 16; t++) if (e[t] > e[best]) best = t
    return best
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
    const symbols = Array.from({ length: count }, (_, k) => this.wholeSymbolAt(start + k * c.sym, diff, k, body))
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
      conf = Math.min(conf, this.confidenceAt(start + k * c.sym, diff, setFor(c, k, b)))
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
        const bodyLen = this.c.symbols(len + CRC + this.c.parity) * sym
        if (!heads.some(f => f.body === header + hdr * sym && f.len === len)) heads.push({ body: header + hdr * sym, len })
        if (s - bodyLen >= this.bufStart && s - bodyLen >= this.lastEnd && !tails.some(f => f.body === s - bodyLen && f.len === len)) {
          tails.push({ body: s - bodyLen, len, end: header + hdr * sym })
        }
      }
      let decoded = false
      for (const { body, len, end } of tails) {
        const payload = this.decodeBody(body, len + CRC + this.c.parity)
        if (payload == null) continue
        this.lastEnd = body + this.c.symbols(len + CRC + this.c.parity) * sym
        this.scan = Math.max(this.scan, end)
        this.onFrame(payload)
        decoded = true
        break
      }
      if (decoded) continue
      for (const { body, len } of heads) {
        const bodyEnd = body + this.c.symbols(len + CRC + this.c.parity) * sym
        // body still on its way: remember it and keep scanning, so a phantom length can't stall the receiver
        if (bodyEnd > this.end) { if (this.pending.length < 64) this.pending.push({ body, len }); continue }
        if (this.tryHead(body, len)) { decoded = true; break }
      }
      if (decoded) continue
      this.scan = last + hop
    }
  }

  private tryHead (body: number, len: number): boolean {
    const payload = this.decodeBody(body, len + CRC + this.c.parity)
    if (payload == null) return false
    this.lastEnd = body + this.c.symbols(len + CRC + this.c.parity) * this.c.sym
    // keep scanning from just after this frame's header: another sender's frame may overlap this one and
    // its sync must still be found (lastEnd stops this body from being decoded twice via its tail)
    this.scan = Math.max(this.scan, body)
    this.pending = this.pending.filter(p => p.body >= this.lastEnd)
    this.onFrame(payload)
    return true
  }

  /** Decode remembered frame heads whose bodies have now fully arrived. */
  private flushPending (): void {
    const sym = this.c.sym
    for (const p of this.pending.splice(0)) {
      if (p.body < this.lastEnd) continue
      if (p.body + this.c.symbols(p.len + CRC + this.c.parity) * sym > this.end) { this.pending.push(p); continue }
      this.tryHead(p.body, p.len)
    }
  }

  private pending: Array<{ body: number, len: number }> = [] // frame heads waiting for their body
  private lastEnd = 0 // end of the last decoded body, so a tail never re-decodes it
}
