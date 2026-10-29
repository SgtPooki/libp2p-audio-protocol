// Scores the experimental OFDM modem (src/ofdm.ts) on the scorecard's channel models.
// Run: node benchmarks/ofdm.ts [--trials 50 --preset ofdm64 --only reverb]
//
// A trimmed copy of benchmarks/scorecard.ts (no late join), with the rows used in
// notes/research-throughput2-opus.md first, in the same order, so seed 1 reproduces that table:
// SNR 3 and 4.5 dB, 3000 ppm drift, near-field reverb, reverb at 10 dB, a collision in reverb.
// Two model changes from scorecard.ts: reverb() takes a DRR, and drift() resamples with a windowed sinc
// (linear interpolation images an 18 kHz tone at 48 kHz back onto itself, ~9 dB down).
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { modulate, Demodulator, OFDM_PRESETS, type OfdmOptions } from '../src/ofdm.ts'

const { values: args } = parseArgs({
  options: {
    trials: { type: 'string', default: '50' },
    preset: { type: 'string' },
    only: { type: 'string' }, // run only conditions whose label contains this
    out: { type: 'string' },
    seed: { type: 'string', default: '1' }
  }
})
const TRIALS = Number(args.trials)
const PAYLOAD = 117 // a signed "hello" envelope

// ---------- seeded randomness ----------
type Rng = () => number
function mulberry32 (seed: number): Rng {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const gauss = (r: Rng): number => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())

// ---------- channel impairments ----------
interface Sim { rate: number, r: Rng, band: [number, number] }
const power = (x: Float32Array, from = 0, to = x.length): number => {
  let s = 0
  for (let i = from; i < to; i++) s += x[i] * x[i]
  return s / (to - from)
}

/** White noise scaled so the noise power inside the modem's band is `snrDb` below the signal. */
function addNoise (x: Float32Array, sigPower: number, snrDb: number, s: Sim): Float32Array {
  const bandShare = (s.band[1] - s.band[0]) / (s.rate / 2)
  const sigma = Math.sqrt(sigPower / 10 ** (snrDb / 10) / bandShare)
  return x.map(v => v + sigma * gauss(s.r))
}

/**
 * Sparse synthetic room impulse response: direct path plus exponentially decaying reflections,
 * scaled so reflected energy equals direct energy (direct-to-reverberant ratio 0 dB, i.e. a
 * listener at the room's critical distance).
 */
function reverb (x: Float32Array, rt60: number, s: Sim, drr = 0): Float32Array {
  const refl: Array<[number, number]> = []
  for (let k = 0; k < 80; k++) {
    const t = 0.002 + s.r() * rt60
    refl.push([Math.round(t * s.rate), (s.r() < 0.5 ? -1 : 1) * Math.exp(-6.9 * t / rt60)])
  }
  const norm = Math.sqrt(refl.reduce((e, [, a]) => e + a * a, 0)) * 10 ** (drr / 20)
  const taps: Array<[number, number]> = [[0, 1], ...refl.map(([d, a]): [number, number] => [d, a / norm])]
  const out = new Float32Array(x.length)
  for (const [d, a] of taps) for (let i = d; i < x.length; i++) out[i] += a * x[i - d]
  return out
}

function biquad (x: Float32Array, rate: number, f: number, type: 'lp' | 'hp'): Float32Array {
  const w = 2 * Math.PI * f / rate
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2)
  const cos = Math.cos(w)
  const [b0, b1, b2] = type === 'lp' ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2] : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
  const [a0, a1, a2] = [1 + alpha, -2 * cos, 1 - alpha]
  const out = new Float32Array(x.length)
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y
    out[i] = y
  }
  return out
}

/** Handheld radio: 300-3000 Hz (4th order), AGC, hard-ish clipping, first 200 ms lost to squelch/PTT. */
function radio (x: Float32Array, txStart: number, s: Sim): Float32Array {
  let y = biquad(biquad(biquad(biquad(x, s.rate, 300, 'hp'), s.rate, 300, 'hp'), s.rate, 3000, 'lp'), s.rate, 3000, 'lp')
  let env = 0.01
  const attack = 1 - Math.exp(-1 / (0.01 * s.rate))
  const release = 1 - Math.exp(-1 / (0.3 * s.rate))
  y = y.map(v => {
    const a = Math.abs(v)
    env += (a > env ? attack : release) * (a - env)
    return Math.tanh(3 * v * 0.5 / Math.max(env, 1e-3))
  })
  y.fill(0, txStart, txStart + Math.round(0.2 * s.rate))
  return y
}

/** Receiver clock off by `ppm` (linear interpolation resample). */
function drift (x: Float32Array, ppm: number): Float32Array {
  const k = 1 + ppm * 1e-6
  return Float32Array.from({ length: Math.floor(x.length / k) }, (_, i) => {
    const t = i * k; const j = Math.floor(t); let acc = 0
    for (let q = j - 7; q <= j + 8; q++) { const u = t - q; const w = 0.5 + 0.5 * Math.cos(Math.PI * u / 8.5); acc += (x[q] ?? 0) * w * (u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u)) }
    return acc
  })
}

// ---------- trial runner ----------
interface Tx { wave: Float32Array, payload: Uint8Array, start: number }
type Channel = (stream: Float32Array, tx: Tx, s: Sim, opts: OfdmOptions) => Float32Array

function trial (opts: OfdmOptions, channel: Channel, s: Sim): { ok: boolean, cpu: number, audio: number } {
  const payload = Uint8Array.from({ length: PAYLOAD }, () => Math.floor(s.r() * 256))
  const wave = modulate(payload, s.rate, opts)
  const start = Math.round((0.2 + 0.5 * s.r()) * s.rate)
  const stream = new Float32Array(start + wave.length + s.rate)
  for (let i = 0; i < wave.length; i++) stream[start + i] = 0.5 * wave[i]
  const heard = channel(stream, { wave, payload, start }, s, opts)
  let ok = false
  const rx = new Demodulator(s.rate, p => { if (p.length === payload.length && p.every((b, i) => b === payload[i])) ok = true }, opts)
  const t0 = performance.now()
  for (let i = 0; i < heard.length; i += 4096) rx.push(heard.subarray(i, i + 4096))
  return { ok, cpu: performance.now() - t0, audio: heard.length / s.rate }
}

/** Mild in-band noise floor under every condition, so "silence" is never perfectly clean. */
const floor = (snr = 20): Channel => (x, tx, s) => addNoise(x, power(x, tx.start, tx.start + tx.wave.length), snr, s)
const then = (...cs: Channel[]): Channel => (x, tx, s, o) => cs.reduce((y, c) => c(y, tx, s, o), x)

/** Lose `secs` of audio at a frame position: 'sync' (preamble), 'header', 'body' (middle), 'end'. */
function dropAt (where: 'sync' | 'header' | 'body' | 'end', secs: number, burst = false): Channel {
  return (x, tx, s, opts) => {
    const sym = (opts.symbolSeconds ?? 0.04) * s.rate
    const frame = tx.wave.length
    const at = tx.start + Math.round({ sync: 6 * sym, header: 10 * sym, body: frame / 2, end: frame - secs * s.rate }[where])
    const y = x.slice()
    const n = Math.round(secs * s.rate)
    const amp = Math.sqrt(power(x, tx.start, tx.start + frame)) * 3
    for (let i = at; i < at + n && i < y.length; i++) y[i] = burst ? amp * gauss(s.r) : 0
    return y
  }
}

function collide (relDb: number): Channel {
  return (x, tx, s, opts) => {
    const other = modulate(Uint8Array.from({ length: PAYLOAD }, () => Math.floor(s.r() * 256)), s.rate, opts)
    const offset = tx.start + Math.round((s.r() - 0.5) * tx.wave.length)
    const g = 0.5 * 10 ** (relDb / 20)
    const y = x.slice()
    for (let i = 0; i < other.length; i++) { const j = offset + i; if (j >= 0 && j < y.length) y[j] += g * other[i] }
    return y
  }
}

/** White noise at a fixed level, the same for every preset: in-band SNR flatters wide and multi-band presets, this does not. */
const fixedNoise = (sigma: number): Channel => (x, _tx, s) => x.map(v => v + sigma * gauss(s.r))

const CONDITIONS: Array<[string, Channel]> = [
  ['in-band SNR 3 dB', floor(3)],
  ['in-band SNR 4.5 dB', floor(4.5)],
  ['drift 3000 ppm (1 m/s walking)', then(floor(), x => drift(x, 3000))],
  ['reverb RT60 0.8 s, DRR +6 dB', then(floor(), (x, _t, s) => reverb(x, 0.8, s, 6))],
  ['reverb RT60 0.3 s, DRR 0 dB, SNR 10 dB', then(floor(10), (x, _t, s) => reverb(x, 0.3, s))],
  ['collision 0 dB, reverb 0.3 s', then(collide(0), floor(), (x, _t, s) => reverb(x, 0.3, s))],
  ['clean (20 dB in-band SNR)', floor()],
  ['white noise, same level for every preset (sigma 0.3)', fixedNoise(0.3)],
  ['white noise, same level for every preset (sigma 0.6)', fixedNoise(0.6)],
  ['in-band SNR 6 dB', floor(6)],
  ['in-band SNR 0 dB', floor(0)],
  ['in-band SNR -6 dB', floor(-6)],
  ['reverb RT60 0.3 s, DRR 0 dB', then(floor(), (x, _t, s) => reverb(x, 0.3, s))],
  ['reverb RT60 0.8 s, DRR 0 dB', then(floor(), (x, _t, s) => reverb(x, 0.8, s))],
  ['radio chain (300-3000 Hz, AGC, clip, -200 ms)', then(floor(), (x, t, s) => radio(x, t.start, s))],
  ['clock drift 100 ppm', then(floor(), x => drift(x, 100))],
  ['clock drift 1000 ppm', then(floor(), x => drift(x, 1000))],
  ['collision, other sender -6 dB', then(collide(-6), floor())],
  ['collision, other sender 0 dB', then(collide(0), floor())],
  ['0.3 s silence in sync', then(floor(), dropAt('sync', 0.3))],
  ['0.3 s silence in header', then(floor(), dropAt('header', 0.3))],
  ['0.3 s silence mid-body', then(floor(), dropAt('body', 0.3))],
  ['1 s silence mid-body', then(floor(), dropAt('body', 1))],
  ['0.3 s loud noise burst mid-body', then(floor(), dropAt('body', 0.3, true))],
  ['1 s loud noise burst mid-body', then(floor(), dropAt('body', 1, true))]
]

function wilson (k: number, n: number): string {
  const z = 1.96; const p = k / n
  const d = 1 + z * z / n
  const c = (p + z * z / (2 * n)) / d
  const h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
  return `${Math.round(p * 100)}% (${Math.round((c - h) * 100)}-${Math.round((c + h) * 100)})`
}

// ---------- run ----------
const presets = Object.entries(OFDM_PRESETS).filter(([n]) => args.preset == null || args.preset === n) as Array<[string, OfdmOptions]>
const rows: string[][] = []
const cpu: string[] = []
const meta: string[] = []
for (const [name, opts] of presets) {
  const rate = opts.hi > 6500 ? 48000 : 16000 // 16 kHz is plenty below 6.5 kHz and 3x faster to simulate
  const band: [number, number] = [opts.lo - 200, opts.hi + 200]
  const s: Sim = { rate, band, r: mulberry32(Number(args.seed)) }
  const air = modulate(new Uint8Array(PAYLOAD), rate, opts).length / rate
  meta.push(`${name}: ${(PAYLOAD / air).toFixed(1)} B/s, ${air.toFixed(2)} s per ${PAYLOAD}-byte frame`)
  let cpuMs = 0; let cpuAudio = 0
  CONDITIONS.filter(([label]) => args.only == null || label.includes(args.only)).forEach(([label, channel], ci) => {
    let ok = 0
    for (let t = 0; t < TRIALS; t++) {
      const res = trial(opts, channel, s)
      if (res.ok) ok++
      if (ci === 0) { cpuMs += res.cpu; cpuAudio += res.audio }
    }
    rows[ci] ??= [label]
    rows[ci].push(wilson(ok, TRIALS))
    process.stderr.write(`${name} | ${label}: ${ok}/${TRIALS}\n`)
  })
  cpu.push(`${name}: ${(cpuMs / Math.max(cpuAudio, 1e-9)).toFixed(1)} ms per audio second (sim rate ${rate / 1000} kHz)`)
}

const header = ['condition', ...presets.map(([n]) => n)]
const md = `# OFDM scorecard (experimental, src/ofdm.ts)

Seed ${args.seed}, ${TRIALS} trials per cell, ${PAYLOAD}-byte frames, streamed in 4096-sample chunks.
Cells: frames decoded byte-exact, with Wilson 95% interval.

${meta.map(m => `- ${m}`).join('\n')}

${[header, header.map(() => '---'), ...rows].map(r => `| ${r.join(' | ')} |`).join('\n')}

CPU (this machine):
${cpu.map(c => `- ${c}`).join('\n')}
`
console.log(md)
if (args.out != null) writeFileSync(args.out, md)
