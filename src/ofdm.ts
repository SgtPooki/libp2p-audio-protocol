// EXPERIMENTAL OFDM-DQPSK modem: near field, quiet rooms only. Not in PRESETS, not used by the transport.
// Same API as src/modem.ts (modulate / Demodulator / maxPayload) so benchmarks/ofdm.ts can score it.
// Scorecard (notes/research-throughput2-opus.md): 2.5x turbo at 1-6.5 kHz, but 0% at in-band SNR <= 3 dB,
// on every dropout row and in equal-power collisions. Noncoherent MFSK stays the default for good reasons.
//
// Frame: [LFM chirp][ref symbol][header symbol][data symbols][LFM chirp], each symbol = cyclic prefix + FFT.
//   ref     known QPSK phases per carrier
//   header  16 bits (len, ~len) as DBPSK against the ref, each bit repeated over 1/16 of the carriers
//   data    RS(len + 4 + parity) -> conv K=7 r=1/2 -> seeded random interleaver -> time-differential DQPSK
// The head-to-tail chirp spacing gives the clock offset / Doppler and the symbol count; the receiver resamples
// the whole frame onto the transmitter's clock before the FFTs. Output is hard-clipped to `clip` dB over rms.
import { rsEncode, rsDecode } from './rs.ts'

/** In-place radix-2 complex FFT; inverse (scaled by 1/n) when `inv`. */
function fft (re: Float64Array, im: Float64Array, inv = false): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inv ? 2 : -2) * Math.PI / len
    const wr = Math.cos(ang); const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1; let ci = 0
      for (let j = 0; j < len / 2; j++) {
        const a = i + j; const b = a + len / 2
        const tr = re[b] * cr - im[b] * ci; const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n }
}

// Rate-1/2 K=7 convolutional code, 171/133 octal (src/conv.ts is the punctured rate-2/3 one), 6 tail bits
const G = [0o171, 0o133]
const par = (x: number): number => { x ^= x >> 4; x ^= x >> 2; x ^= x >> 1; return x & 1 }
const OUT = Uint8Array.from({ length: 128 }, (_, r) => (par(r & G[0]) << 1) | par(r & G[1]))
const codedLen = (n: number): number => 2 * (n + 6)
function convEncode (bits: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(codedLen(bits.length)); let reg = 0
  for (let i = 0; i < bits.length + 6; i++) {
    reg = ((reg << 1) | (i < bits.length ? bits[i] : 0)) & 0x7f
    out[2 * i] = OUT[reg] >> 1; out[2 * i + 1] = OUT[reg] & 1
  }
  return out
}
/** Soft Viterbi, positive LLR = 1, `n` data bits out. */
function viterbi (llr: ArrayLike<number>, n: number): Uint8Array {
  const steps = n + 6
  let m = new Float64Array(64).fill(-Infinity); m[0] = 0; let nx = new Float64Array(64)
  const from = new Uint8Array(steps * 64)
  for (let i = 0; i < steps; i++) {
    const a = llr[2 * i]; const b = llr[2 * i + 1]
    nx.fill(-Infinity)
    for (let s = 0; s < 64; s++) {
      if (m[s] === -Infinity) continue
      for (let bit = 0; bit < 2; bit++) {
        if (i >= n && bit === 1) continue
        const reg = (s << 1) | bit; const o = OUT[reg]
        const v = m[s] + ((o & 2) !== 0 ? a : -a) + ((o & 1) !== 0 ? b : -b); const ns = reg & 63
        if (v > nx[ns]) { nx[ns] = v; from[i * 64 + ns] = s }
      }
    }
    [m, nx] = [nx, m]
  }
  const out = new Uint8Array(n); let s = 0
  for (let i = steps - 1; i >= 0; i--) { if (i < n) out[i] = s & 1; s = from[i * 64 + s] }
  return out
}

export interface OfdmOptions {
  /** FFT length in seconds; must be a power-of-2 number of samples at the sample rate. */
  fft: number
  /** Cyclic prefix, seconds. Echo energy within it is free; past it, it leaks by (delay - cp) / fft. */
  cp: number
  /** Carrier band, Hz. */
  lo: number
  hi: number
  /** Reed-Solomon parity bytes. Default 32. */
  parity?: number
  /** Hard-clip the output at this many dB above its rms (speakers are peak-limited). */
  clip?: number
  /** Only for the scorecard's dropout rows, which place sync/header holes in symbols of this length. */
  symbolSeconds?: number
}

export const OFDM_PRESETS = {
  /** 1-6.5 kHz, 64 ms FFT + 32 ms CP: 166 B/s in the scorecard. */
  ofdm64: { fft: 0.064, cp: 0.032, lo: 1000, hi: 6500, clip: 6, symbolSeconds: 0.016 },
  /** Longer symbols for reverberant rooms (RT60 0.8 s at DRR 0 dB: 98%): 114 B/s. */
  ofdm128: { fft: 0.128, cp: 0.064, lo: 1000, hi: 6500, clip: 6, symbolSeconds: 0.016 },
  /** 17-19 kHz, 4096-point FFT at 48 kHz: 87 B/s. Phone hardware response up there is unverified. */
  ofdmUS: { fft: 4096 / 48000, cp: 0.032, lo: 17000, hi: 19000, clip: 6, symbolSeconds: 0.016 }
} satisfies Record<string, OfdmOptions>

const CRC = 4
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
const crc32 = (b: Uint8Array): number => { let c = 0xffffffff; for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

interface Cfg { N: number, cp: number, L: number, bins: number[], parity: number, chirp: Float64Array, rate: number, lo: number, hi: number }
function cfg (rate: number, o: OfdmOptions): Cfg {
  const N = Math.round(o.fft * rate)
  if ((N & (N - 1)) !== 0) throw new RangeError('the FFT must be a power-of-2 number of samples at this rate')
  const cp = Math.round(o.cp * rate)
  const bins: number[] = []
  for (let k = Math.ceil(o.lo * N / rate); k <= Math.floor(o.hi * N / rate); k++) bins.push(k)
  const { lo, hi } = o; const T = N / rate
  const chirp = Float64Array.from({ length: N }, (_, n) => { const t = n / rate; const w = Math.min(1, n / (0.002 * rate), (N - n) / (0.002 * rate)); return w * Math.sin(2 * Math.PI * (lo * t + (hi - lo) * t * t / (2 * T))) })
  return { N, cp, L: N + cp, bins, parity: o.parity ?? 32, chirp, rate, lo, hi }
}
const nbitsFor = (len: number, c: Cfg): number => 8 * (len + CRC + c.parity)
const symsFor = (len: number, c: Cfg): number => Math.ceil(codedLen(nbitsFor(len, c)) / (c.bins.length * 2))
function perm (n: number, seed: number): Int32Array {
  const p = Int32Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const j = seed % (i + 1); const t = p[i]; p[i] = p[j]; p[j] = t }
  return p
}
const REF = perm(4096, 12345)
const refPhase = (i: number): number => (REF[i] % 4) * Math.PI / 2 + Math.PI / 4

function synth (ph: number[], c: Cfg, out: Float64Array, at: number): void {
  const re = new Float64Array(c.N); const im = new Float64Array(c.N)
  c.bins.forEach((k, i) => { re[k] = Math.cos(ph[i]); im[k] = Math.sin(ph[i]); re[c.N - k] = re[k]; im[c.N - k] = -im[k] })
  fft(re, im, true)
  for (let n = 0; n < c.L; n++) out[at + n] = re[(n - c.cp + c.N) % c.N]
}

export const maxPayload = (o?: Pick<OfdmOptions, 'parity'>): number => 255 - (o?.parity ?? 32) - CRC

export function modulate (payload: Uint8Array, rate: number, o: OfdmOptions): Float32Array {
  const c = cfg(rate, o)
  if (payload.length === 0 || payload.length > maxPayload(o)) throw new RangeError(`payload must be 1..${maxPayload(o)} bytes`)
  const len = payload.length
  const data = new Uint8Array(len + CRC); data.set(payload); new DataView(data.buffer).setUint32(len, crc32(payload))
  const cw = rsEncode(data, c.parity)
  const bits = Array.from({ length: 8 * cw.length }, (_, i) => (cw[i >> 3] >> (7 - (i & 7))) & 1)
  const coded = convEncode(bits)
  const M = symsFor(len, c); const slots = M * c.bins.length * 2
  const p = perm(slots, len)
  const tx = new Uint8Array(slots); for (let i = 0; i < coded.length; i++) tx[p[i]] = coded[i]
  const out = new Float64Array(2 * c.N + (M + 2) * c.L)
  // chirp at the same per-sample amplitude as the OFDM symbols' rms
  const rmsSym = Math.sqrt(c.bins.length * 2) / c.N
  for (let n = 0; n < c.N; n++) out[n] = c.chirp[n] * rmsSym * Math.SQRT2
  let ph = c.bins.map((_, i) => refPhase(i))
  synth(ph, c, out, c.N)
  const hdr = [...Array(8)].map((_, j) => (len >> (7 - j)) & 1); for (let j = 0; j < 8; j++) hdr.push(1 - hdr[j])
  ph = ph.map((v, i) => v + (hdr[i % 16] ? Math.PI : 0))
  synth(ph, c, out, c.N + c.L)
  for (let s = 0; s < M; s++) {
    ph = ph.map((v, i) => {
      const idx = (s * c.bins.length + i) * 2
      return v + [[0, 1], [3, 2]][tx[idx]][tx[idx + 1]] * Math.PI / 2 // Gray
    })
    synth(ph, c, out, c.N + (s + 2) * c.L)
  }
  // tail chirp: head-to-tail spacing gives the clock offset / Doppler, and its position gives the symbol count
  for (let n = 0; n < c.N; n++) out[c.N + (M + 2) * c.L + n] = c.chirp[n] * rmsSym * Math.SQRT2
  if (o.clip != null) { // hard clip at clip dB above the rms: speakers are peak-limited
    let ss = 0; for (const v of out) ss += v * v
    const lim = Math.sqrt(ss / out.length) * 10 ** (o.clip / 20)
    for (let n = 0; n < out.length; n++) out[n] = Math.max(-lim, Math.min(lim, out[n]))
  }
  let peak = 0; for (const v of out) peak = Math.max(peak, Math.abs(v))
  const f = Math.round(0.005 * rate)
  const res = Float32Array.from(out, v => 0.8 * v / peak)
  for (let n = 0; n < f; n++) { res[n] *= n / f; res[res.length - 1 - n] *= n / f }
  return res
}

export class Demodulator {
  private readonly c: Cfg
  private buf = new Float64Array(0)
  private bufStart = 0
  private scan = 0
  private pending: Array<{ t0: number, nextM?: number }> = []
  private decoded: number[] = []
  private readonly onFrame: (p: Uint8Array) => void
  private readonly cf: [Float64Array, Float64Array]
  private readonly F: number
  constructor (rate: number, onFrame: (p: Uint8Array) => void, o: OfdmOptions) {
    this.c = cfg(rate, o); this.onFrame = onFrame
    this.F = 4 * this.c.N
    const re = new Float64Array(this.F); const im = new Float64Array(this.F)
    re.set(this.c.chirp); fft(re, im)
    this.cf = [re, im]
  }

  push (x: Float32Array): void {
    const n = new Float64Array(this.buf.length + x.length); n.set(this.buf); n.set(x, this.buf.length); this.buf = n
    this.process()
    const keep = Math.min(this.scan, ...this.pending.map(p => p.t0)) - this.c.N
    if (keep > this.bufStart) { this.buf = this.buf.slice(keep - this.bufStart); this.bufStart = keep }
  }

  busy (): boolean { return false }
  private get end (): number { return this.bufStart + this.buf.length }

  private process (): void {
    const { N } = this.c; const F = this.F; const B = F - N
    while (this.scan + F <= this.end) {
      const off = this.scan - this.bufStart
      const re = this.buf.slice(off, off + F); const im = new Float64Array(F)
      fft(re, im)
      for (let k = 0; k < F; k++) { const a = re[k]; const b = im[k]; const cr = this.cf[0][k]; const ci = -this.cf[1][k]; re[k] = a * cr - b * ci; im[k] = a * ci + b * cr }
      fft(re, im, true)
      // energy-normalized correlation: 1 = a perfect chirp
      let ec = 0; for (const v of this.c.chirp) ec += v * v
      let e = 0; for (let n = 0; n < N; n++) e += this.buf[off + n] ** 2
      let found = -1
      for (let n = 0; n < B; n++) {
        if (n > 0) e += this.buf[off + n + N - 1] ** 2 - this.buf[off + n - 1] ** 2
        const v = re[n] / Math.sqrt(Math.max(e, 1e-12) * ec)
        if (v > 0.2) { found = n; break }
      }
      if (found < 0) { this.scan += B; continue }
      // strongest correlation within 10 ms of the first crossing = the direct path
      let best = found; let bv = -Infinity
      const w = Math.round(0.01 * this.c.rate)
      for (let n = found; n < Math.min(B, found + w); n++) if (re[n] > bv) { bv = re[n]; best = n }
      const t0 = this.scan + best
      if (!this.pending.some(p => Math.abs(p.t0 - t0) < N / 4) && !this.decoded.some(d => Math.abs(d - t0) < N / 4)) this.pending.push({ t0 })
      this.scan = t0 + N / 2
    }
    this.flush()
  }

  private seg?: Float64Array // the current frame, resampled to the transmitter's clock; index 0 = head chirp start

  private spectrum (at: number): [Float64Array, Float64Array] | undefined {
    const { N, bins } = this.c
    const off = Math.round(at)
    if (this.seg == null || off < 0 || off + N > this.seg.length) return undefined
    const re = this.seg.slice(off, off + N); const im = new Float64Array(N)
    fft(re, im)
    return [Float64Array.from(bins, k => re[k]), Float64Array.from(bins, k => im[k])]
  }

  /** Start of symbol `s`'s FFT window in the resampled frame (0 = ref, 1 = header), 2 ms early against timing error. */
  private symAt (s: number): number { return this.c.N + s * this.c.L + this.c.cp - Math.round(0.002 * this.c.rate) }

  /** Normalized chirp correlation peak in [from, to): [position with sub-sample refinement, value]. */
  private chirpPeak (from: number, to: number, k = 1): [number, number] {
    const { N, rate } = this.c
    const { lo, hi } = this.c; const T = N / rate
    // template stretched by k receiver samples per transmitter sample (an LFM chirp's peak smears under Doppler otherwise)
    // quadrature pair: the envelope peak, not a carrier cycle (2.7 samples at 18 kHz / 48 kHz) of the real correlation
    const ph = (n: number): number => { const t = n / k / rate; return 2 * Math.PI * (lo * t + (hi - lo) * t * t / (2 * T)) }
    const Nk = Math.min(Math.round(N * k), N)
    const chirp = Float64Array.from({ length: Nk }, (_, n) => Math.sin(ph(n)))
    const chirpQ = Float64Array.from({ length: Nk }, (_, n) => Math.cos(ph(n)))
    let ec = 0; for (const v of chirp) ec += v * v
    const vals: number[] = []
    for (let t = from; t < to; t++) {
      const off = t - this.bufStart; let acc = 0; let accQ = 0; let e = 0
      for (let n = 0; n < Nk; n++) { const v = this.buf[off + n] ?? 0; acc += v * chirp[n]; accQ += v * chirpQ[n]; e += v * v }
      vals.push(Math.hypot(acc, accQ) / Math.sqrt(Math.max(e, 1e-12) * ec))
    }
    let b = 0; for (let i = 1; i < vals.length; i++) if (vals[i] > vals[b]) b = i
    const y0 = vals[b - 1] ?? vals[b]; const y1 = vals[b]; const y2 = vals[b + 1] ?? vals[b]
    const den = y0 - 2 * y1 + y2
    return [from + b + (den < 0 ? 0.5 * (y0 - y2) / den : 0), y1]
  }

  private flush (): void {
    const c = this.c
    const maxM = symsFor(maxPayload({ parity: c.parity }), c)
    for (const p of this.pending.splice(0)) {
      let M = p.nextM ?? 1; let found: number | undefined
      for (; M <= maxM; M++) {
        const nominal = c.N + (M + 2) * c.L
        const d = Math.ceil(0.002 * nominal + 0.004 * c.rate)
        const te = p.t0 + nominal
        if (te + d + c.N > this.end) break
        // the tail for this length? (the head is the earliest strong arrival; take the strongest near the expected spot)
        const [pos, v] = this.chirpPeak(te - d, te + d)
        if (v > 0.25) { found = pos; break }
      }
      if (found == null) { if (M <= maxM) { p.nextM = M; this.pending.push(p) } continue }
      const span = c.N + (M + 2) * c.L
      p.t0 = this.chirpPeak(Math.round(p.t0) - 96, Math.round(p.t0) + 96)[0] // sub-sample head
      let tail: number = found
      let k = (tail - p.t0) / span // receiver samples per transmitter sample
      for (let it = 0; it < 2; it++) { // re-time both chirps with a template stretched by the estimate
        const w = it === 0 ? 64 : 4
        const h = this.chirpPeak(Math.round(p.t0) - w, Math.round(p.t0) + w, k)[0]
        const t = this.chirpPeak(Math.round(tail) - w, Math.round(tail) + w, k)[0]
        p.t0 = h; tail = t; k = (t - h) / span
      }
      // resample the frame onto the transmitter's clock (8-tap-per-side Hann-windowed sinc)
      this.seg = Float64Array.from({ length: span + c.N }, (_, n) => {
        const t = p.t0 + n * k - this.bufStart; const j = Math.floor(t); let acc = 0
        for (let q = j - 7; q <= j + 8; q++) { const x = t - q; const w = 0.5 + 0.5 * Math.cos(Math.PI * x / 8.5); acc += (this.buf[q] ?? 0) * w * (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) }
        return acc
      })
      const ref = this.spectrum(this.symAt(0))!; const h = this.spectrum(this.symAt(1))!
      const soft = new Float64Array(16)
      h[0].forEach((_, i) => { soft[i % 16] += -(h[0][i] * ref[0][i] + h[1][i] * ref[1][i]) })
      let len = 0; let ok = true
      for (let j = 0; j < 8; j++) { const b = soft[j] > 0 ? 1 : 0; const nb = soft[j + 8] > 0 ? 1 : 0; if (b === nb) ok = false; len = (len << 1) | b }
      if (!ok || len === 0 || len > maxPayload({ parity: c.parity }) || symsFor(len, c) !== M) continue
      const payload = this.decodeBody(len)
      if (payload != null) { this.decoded.push(p.t0); if (this.decoded.length > 16) this.decoded.shift(); this.onFrame(payload) }
    }
  }

  private decodeBody (len: number): Uint8Array | undefined {
    const c = this.c
    const M = symsFor(len, c); const slots = M * c.bins.length * 2
    const llr = new Float64Array(slots)
    let prev = this.spectrum(this.symAt(1))!
    for (let s = 0; s < M; s++) {
      const z = this.spectrum(this.symAt(s + 2))!
      // time-differential: this symbol times the conjugate of the previous one, per carrier
      const d = c.bins.map((_, i): [number, number] => [z[0][i] * prev[0][i] + z[1][i] * prev[1][i], z[1][i] * prev[0][i] - z[0][i] * prev[1][i]])
      prev = z
      let mag = 0; for (const [x, y] of d) mag += Math.hypot(x, y); mag /= d.length
      // max-log LLRs for Gray DQPSK, rotated by -pi/4
      d.forEach(([x, y], i) => {
        const idx = (s * c.bins.length + i) * 2
        llr[idx] = -4 * (x + y) / Math.SQRT2 / mag; llr[idx + 1] = -4 * (x - y) / Math.SQRT2 / mag
      })
    }
    const nbits = nbitsFor(len, c)
    const p = perm(slots, len)
    const coded = Float64Array.from({ length: codedLen(nbits) }, (_, i) => llr[p[i]])
    const bits = viterbi(coded, nbits)
    const cw = new Uint8Array(nbits / 8); for (let i = 0; i < nbits; i++) cw[i >> 3] |= bits[i] << (7 - (i & 7))
    const data = rsDecode(cw, c.parity)
    if (data == null) return undefined
    const pl = data.subarray(0, len)
    return new DataView(data.buffer, data.byteOffset).getUint32(len) === crc32(pl) ? pl.slice() : undefined
  }
}
