// MFSK-16 acoustic modem: one of 16 tones per symbol = 4 bits per symbol.
// The tone set is a preset (see PRESETS); both sides must use the same one.
//
// On-air frame:
//   preamble  [0,15]x4, 5, 10          sync; receiver matches the last 6 symbols
//   header    len, len^0xff            2 bytes, 4 symbols
//   body      RS(len + 4 + PARITY)      len data bytes + CRC-32 + PARITY parity bytes
// Bytes are sent high nibble first.

import { rsDecode, rsEncode } from './rs.ts'

export const PARITY = 16 // corrects 8 unknown bad bytes, or up to 16 known-bad (erased) ones
const CRC = 4 // CRC-32 catches wrong corrections when erasures use up the RS redundancy
export const MAX_PAYLOAD = 255 - PARITY - CRC

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
  /** Pluck each symbol like a music box note instead of a continuous tone. */
  chime?: boolean
  /** Fade in/out of the whole frame, seconds. Longer hides the start/stop click (matters for ultrasonic). */
  fadeSeconds?: number
}

const linear = (base: number, step: number): number[] => Array.from({ length: 16 }, (_, i) => base + i * step)
// C major pentatonic, C5..C8
const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093, 2349.32, 2637.02, 3135.96, 3520, 4186.01]

export const PRESETS = {
  /** 1000-2500 Hz: fits the 300-3000 Hz voice passband of walkie-talkies / FM radios. */
  voice: { tones: linear(1000, 100) },
  /** Pentatonic music-box notes. Prettier, slower, needs a full-range speaker. */
  chime: { tones: PENTATONIC, chime: true, symbolSeconds: 0.06 },
  /** 17.5-19 kHz: inaudible to most adults; mix it under music. Short range, device dependent. */
  ultrasonic: { tones: linear(17500, 100), fadeSeconds: 0.05 }
} satisfies Record<string, ModemOptions>
export type Preset = keyof typeof PRESETS

const PREAMBLE = [0, 15, 0, 15, 0, 15, 0, 15, 5, 10]
const SYNC = PREAMBLE.slice(-6)
const HOPS = 8 // detection resolution: hops per symbol

interface Config { sym: number, hop: number, tones: number[], sampleRate: number }

function config (sampleRate: number, opts: ModemOptions = {}): Config {
  const { symbolSeconds = 0.04, tones = PRESETS.voice.tones } = opts
  if (tones.length !== 16) throw new RangeError('need exactly 16 tones')
  const hop = Math.round(symbolSeconds * sampleRate / HOPS)
  return { sym: hop * HOPS, hop, tones, sampleRate }
}

function toSymbols (bytes: Uint8Array): number[] {
  const out: number[] = []
  for (const b of bytes) out.push(b >> 4, b & 15)
  return out
}

/** Encode a payload into mono float samples at `sampleRate`. */
export function modulate (payload: Uint8Array, sampleRate: number, opts?: ModemOptions): Float32Array {
  if (payload.length === 0 || payload.length > MAX_PAYLOAD) throw new RangeError(`payload must be 1..${MAX_PAYLOAD} bytes`)
  const c = config(sampleRate, opts)
  const symbols = [
    ...PREAMBLE,
    ...toSymbols(Uint8Array.of(payload.length, payload.length ^ 0xff)),
    ...toSymbols(rsEncode(withCrc(payload), PARITY))
  ]
  const out = new Float32Array(symbols.length * c.sym)
  const attack = Math.round(0.004 * sampleRate)
  let phase = 0 // continuous phase avoids clicks between symbols
  symbols.forEach((s, i) => {
    const step = 2 * Math.PI * c.tones[s] / sampleRate
    for (let n = 0; n < c.sym; n++) {
      // chime: quick attack, then decay to ~35% by the end of the note
      const env = opts?.chime === true ? Math.min(1, n / attack) * Math.exp(-n / c.sym) : 1
      out[i * c.sym + n] = 0.8 * env * Math.sin(phase)
      phase += step
    }
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
  private readonly energies = new Map<number, Float64Array>() // window start -> tone energies
  private readonly coefs: number[]
  private readonly onFrame: (payload: Uint8Array) => void

  constructor (sampleRate: number, onFrame: (payload: Uint8Array) => void, opts?: ModemOptions) {
    this.onFrame = onFrame
    this.c = config(sampleRate, opts)
    this.coefs = this.c.tones.map(f => 2 * Math.cos(2 * Math.PI * f / sampleRate))
  }

  push (samples: Float32Array): void {
    const next = new Float32Array(this.buf.length + samples.length)
    next.set(this.buf)
    next.set(samples, this.buf.length)
    this.buf = next
    this.process()
    // keep at most ~20s of audio (longest frame is ~16s at default speed)
    const keepFrom = Math.min(this.scan - this.c.sym, this.bufStart + this.buf.length - 20 * this.c.sampleRate)
    if (keepFrom > this.bufStart) {
      this.buf = this.buf.slice(keepFrom - this.bufStart)
      this.bufStart = keepFrom
      for (const k of this.energies.keys()) if (k < keepFrom) this.energies.delete(k)
    }
  }

  private get end (): number { return this.bufStart + this.buf.length }

  /** Goertzel energies of the 16 tones over the middle 3/4 of the symbol starting at `start`. */
  private tonesAt (start: number): Float64Array {
    let e = this.energies.get(start)
    if (e != null) return e
    const from = start + this.c.sym / 8 - this.bufStart
    const len = this.c.sym * 3 / 4
    e = new Float64Array(16)
    for (let t = 0; t < 16; t++) {
      const k = this.coefs[t]
      let s1 = 0; let s2 = 0
      for (let n = from; n < from + len; n++) {
        const s0 = this.buf[n] + k * s1 - s2
        s2 = s1; s1 = s0
      }
      e[t] = s1 * s1 + s2 * s2 - k * s1 * s2
    }
    this.energies.set(start, e)
    return e
  }

  private symbolAt (start: number): number {
    start = Math.round(start)
    const e = this.tonesAt(start)
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

  private bytesAt (start: number, n: number): Uint8Array {
    const out = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      out[i] = (this.symbolAt(start + 2 * i * this.c.sym) << 4) | this.symbolAt(start + (2 * i + 1) * this.c.sym)
    }
    return out
  }

  /** How sure we are of the symbol at `start`: best tone energy over runner-up (>= 1). */
  private confidenceAt (start: number): number {
    const e = [...this.tonesAt(start)].sort((a, b) => b - a)
    return e[0] / (e[1] + 1e-12)
  }

  /**
   * RS-decode n bytes at `start`. If plain decoding fails, retry with the least
   * confident bytes marked as erasures: RS fixes 16 erasures but only 8 unknown errors,
   * so a dropout or a burst of noise doesn't sink the frame.
   */
  private decodeBody (start: number, n: number): Uint8Array | undefined {
    const cw = this.bytesAt(start, n)
    const plain = checkCrc(rsDecode(cw, PARITY))
    if (plain != null) return plain
    const sym = this.c.sym
    const conf = Array.from({ length: n }, (_, i) =>
      Math.min(this.confidenceAt(start + 2 * i * sym), this.confidenceAt(start + (2 * i + 1) * sym)))
    const weakest = conf.map((c, i) => [c, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i)
    for (let k = 4; k <= PARITY; k += 4) {
      const payload = checkCrc(rsDecode(cw, PARITY, weakest.slice(0, k)))
      if (payload != null) return payload
    }
    return undefined
  }

  private process (): void {
    const { sym, hop } = this.c
    const syncLen = SYNC.length * sym
    // need room to refine alignment up to one symbol past the first hit
    while (this.scan + syncLen + sym <= this.end) {
      if (this.syncScore(this.scan) < 0.4) { this.scan += hop; continue }

      // Sync matches over a range of offsets, and room echo skews that range late,
      // so try every offset from a bit before the first match to the last match
      // and keep the first one whose Reed-Solomon check passes.
      let last = this.scan
      while (last + hop < this.scan + sym && this.syncScore(last + hop) >= 0.4) last += hop
      const frames: Array<{ body: number, len: number }> = []
      for (let s = Math.max(this.bufStart, this.scan - sym / 4); s <= last; s += hop) {
        const header = s + syncLen
        if (header + 4 * sym > this.end) return // wait for header
        const [len, check] = this.bytesAt(header, 2)
        if (len !== 0 && (len ^ 0xff) === check && len <= MAX_PAYLOAD) frames.push({ body: header + 4 * sym, len })
      }
      let waiting = false
      let decoded = false
      for (const { body, len } of frames) {
        const bodyEnd = body + 2 * (len + CRC + PARITY) * sym
        if (bodyEnd > this.end) { waiting = true; continue }
        const payload = this.decodeBody(body, len + CRC + PARITY)
        if (payload == null) continue
        this.scan = bodyEnd
        this.onFrame(payload)
        decoded = true
        break
      }
      if (decoded) continue
      if (waiting) return // the rest of the frame hasn't arrived yet
      this.scan = last + hop
    }
  }
}
