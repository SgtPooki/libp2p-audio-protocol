// Scorecard v2: simulated channel conditions per modem preset.
// Run: npm run scorecard [-- --trials 100 --preset voice --opts '{"parity":32}' --out benchmarks/BASELINE.md]
//
// Every number is the share of frames decoded byte-exact, with a Wilson 95% interval.
// Runs are seeded, so the same code gives the same table.
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { modulate, Demodulator, PRESETS, type ModemOptions } from '../src/modem.ts'
import { chunks, ChunkCollector } from '../src/broadcast.ts'

const { values: args } = parseArgs({
  options: {
    trials: { type: 'string', default: '100' },
    preset: { type: 'string' },
    only: { type: 'string' }, // run only conditions whose label contains this
    opts: { type: 'string' }, // JSON modem options merged into the preset
    'no-late': { type: 'boolean', default: false },
    'late-only': { type: 'boolean', default: false },
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
interface Sim { rate: number, band: [number, number], seed: number, trial: number, streams: Map<string, Rng> }
/**
 * The random stream for one purpose ('payload', 'noise', 'room', 'collide', 'burst', 'start') in this trial, keyed by
 * (seed, trial, purpose): a condition's inputs do not depend on which other rows ran or how long a waveform is, two
 * presets meet the same rooms and payloads, and another --seed is a held-out set of all of them.
 */
function rng (s: Sim, purpose: string): Rng {
  let r = s.streams.get(purpose)
  if (r == null) {
    let h = 0x811c9dc5
    for (const ch of `${s.seed}:${s.trial}:${purpose}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193)
    r = mulberry32(h >>> 0); s.streams.set(purpose, r)
  }
  return r
}
const power = (x: Float32Array, from = 0, to = x.length): number => {
  let s = 0
  for (let i = from; i < to; i++) s += x[i] * x[i]
  return s / (to - from)
}

/** White noise scaled so the noise power inside the modem's band is `snrDb` below the signal. */
function addNoise (x: Float32Array, sigPower: number, snrDb: number, s: Sim): Float32Array {
  const bandShare = (s.band[1] - s.band[0]) / (s.rate / 2)
  const sigma = Math.sqrt(sigPower / 10 ** (snrDb / 10) / bandShare)
  const r = rng(s, 'noise')
  return x.map(v => v + sigma * gauss(r))
}

/**
 * Sparse synthetic room impulse response: direct path plus exponentially decaying reflections,
 * scaled so reflected energy equals direct energy (direct-to-reverberant ratio 0 dB, i.e. a
 * listener at the room's critical distance).
 */
/** Room (seed, trial): every preset and every A/B pair meets the same rooms (per-room error rates span 0.2-11%); another seed is a held-out bank. */
function reverb (x: Float32Array, rt60: number, s: Sim): Float32Array {
  const r = rng(s, 'room')
  const refl: Array<[number, number]> = []
  // reflections arrive at a rate, not a count: a fixed 80 over RT60 made the 0.8 s room sparser per symbol than the
  // 0.3 s one, and short-symbol presets scored higher in the longer reverb
  for (let k = 0; k < Math.round(80 * rt60 / 0.3); k++) {
    const t = 0.002 + r() * rt60
    refl.push([Math.round(t * s.rate), (r() < 0.5 ? -1 : 1) * Math.exp(-6.9 * t / rt60)])
  }
  const norm = Math.sqrt(refl.reduce((e, [, a]) => e + a * a, 0))
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

/** Receiver clock off by `ppm`: a 16-tap Hann-windowed sinc resampler (linear interpolation aliases near 18 kHz). */
function drift (x: Float32Array, ppm: number): Float32Array {
  const k = 1 + ppm * 1e-6
  const TAPS = 8
  return Float32Array.from({ length: Math.floor(x.length / k) }, (_, i) => {
    const t = i * k; const j = Math.floor(t); const f = t - j
    let acc = 0
    for (let m = -TAPS + 1; m <= TAPS; m++) {
      const d = m - f
      const w = 0.5 * (1 + Math.cos(Math.PI * d / TAPS))
      acc += (x[j + m] ?? 0) * (d === 0 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d)) * w
    }
    return acc
  })
}

// ---------- trial runner ----------
interface Tx { wave: Float32Array, payload: Uint8Array, start: number, others?: Uint8Array[] }
type Channel = (stream: Float32Array, tx: Tx, s: Sim, opts: ModemOptions) => Float32Array

function trial (opts: ModemOptions, channel: Channel, s: Sim): { ok: boolean, both: boolean, cpu: number, audio: number } {
  const payload = Uint8Array.from({ length: PAYLOAD }, () => Math.floor(rng(s, 'payload')() * 256))
  const wave = modulate(payload, s.rate, opts)
  const start = Math.round((0.2 + 0.5 * rng(s, 'start')()) * s.rate)
  const stream = new Float32Array(start + wave.length + s.rate)
  for (let i = 0; i < wave.length; i++) stream[start + i] = 0.5 * wave[i]
  const tx: Tx = { wave, payload, start }
  const heard = channel(stream, tx, s, opts)
  const want = [payload, ...(tx.others ?? [])]
  const got = want.map(() => false)
  const rx = new Demodulator(s.rate, p => { want.forEach((w, i) => { if (p.length === w.length && p.every((b, j) => b === w[j])) got[i] = true }) }, opts)
  const t0 = performance.now()
  for (let i = 0; i < heard.length; i += 4096) rx.push(heard.subarray(i, i + 4096))
  return { ok: got[0], both: got.every(Boolean), cpu: performance.now() - t0, audio: heard.length / s.rate }
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
    const r = rng(s, 'burst')
    for (let i = at; i < at + n && i < y.length; i++) y[i] = burst ? amp * gauss(r) : 0
    return y
  }
}

function collide (relDb: number): Channel {
  return (x, tx, s, opts) => {
    const r = rng(s, 'collide')
    const otherPayload = Uint8Array.from({ length: PAYLOAD }, () => Math.floor(r() * 256))
    const other = modulate(otherPayload, s.rate, opts)
    const offset = tx.start + Math.round((r() - 0.5) * tx.wave.length)
    ;(tx.others ??= []).push(otherPayload) // scored too: a cell reports ours, and both
    const g = 0.5 * 10 ** (relDb / 20)
    // the whole other frame is in the stream too (shift ours right if it starts before 0), so "both" is fair
    const shift = Math.max(0, -offset)
    const y = new Float32Array(Math.max(x.length + shift, offset + shift + other.length))
    y.set(x, shift); tx.start += shift
    for (let i = 0; i < other.length; i++) y[offset + shift + i] += g * other[i]
    return y
  }
}

/**
 * White noise at a fixed spectral density, the same for every preset: in-band SNR flatters wide and
 * multi-band presets, this does not. `sigma` is the per-sample level at a 16 kHz simulation; a 48 kHz
 * simulation spreads the same density over 3x the bandwidth, so its per-sample sigma is sqrt(3) higher.
 */
const fixedNoise = (sigma: number): Channel => (x, _tx, s) => { const g = sigma * Math.sqrt(s.rate / 16000); const r = rng(s, 'noise'); return x.map(v => v + g * gauss(r)) }

const CONDITIONS: Array<[string, Channel]> = [
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
  ['clock drift 3000 ppm (walking speed)', then(floor(), x => drift(x, 3000))],
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

/** CPU ms per audio second while hearing hostile audio: the sync pattern on loop, no valid frames. */
function hostileCpu (opts: ModemOptions, s: Sim): number {
  const sym = Math.round((opts.symbolSeconds ?? 0.04) * s.rate)
  const tones = opts.tones ?? PRESETS.voice.tones
  const seq = [0, 15, 0, 15, 5, 10, 3, 7]
  const audio = Float32Array.from({ length: 30 * s.rate }, (_, i) => 0.5 * Math.sin(2 * Math.PI * tones[seq[Math.floor(i / sym) % seq.length]] * i / s.rate))
  const rx = new Demodulator(s.rate, () => {}, opts)
  const t0 = performance.now()
  for (let i = 0; i < audio.length; i += 4096) rx.push(audio.subarray(i, i + 4096))
  return (performance.now() - t0) / 30
}

// ---------- late join: a looping broadcast, listener tunes in at a random moment ----------
const BLOCK = 60 // fountain data bytes per chunk
const GAP = 0.15 // seconds of silence between frames

/**
 * Transmitter loops `strategy` forever; listener joins at a uniform random time within the
 * first loop and listens for a fixed budget: 2 loops of the whole-frame repeat, for BOTH
 * strategies, so the fountain's chunk overhead counts against it. Returns seconds-to-decode,
 * or undefined if it failed.
 */
function lateJoin (opts: ModemOptions, s: Sim, strategy: 'fountain' | 'repeat', bursts: boolean): number | undefined {
  const message = Uint8Array.from({ length: PAYLOAD }, () => Math.floor(rng(s, 'payload')() * 256))
  const gen = strategy === 'fountain' ? chunks(message, BLOCK) : (function * () { for (;;) yield message })()
  const k = strategy === 'fountain' ? Math.ceil(PAYLOAD / BLOCK) : 1
  const gap = Math.round(GAP * s.rate)
  const frames: Float32Array[] = []
  let loopLen = 0
  let total = 0
  for (let i = 0; i < 4 * k; i++) { // 4 loops: join (< 1 loop) + the listening budget fits
    const w = modulate(gen.next().value as Uint8Array, s.rate, opts)
    frames.push(w)
    if (i < k) loopLen += w.length + gap
    total += w.length + gap
  }
  const stream = new Float32Array(total)
  let at = 0
  for (const w of frames) { for (let i = 0; i < w.length; i++) stream[at + i] = 0.5 * w[i]; at += w.length + gap }
  const budget = 2 * (modulate(message, s.rate, opts).length + gap)
  const join = Math.floor(rng(s, 'start')() * loopLen)
  let heard: Float32Array = stream.slice(join, join + budget)
  const sig = power(stream, 0, loopLen)
  heard = addNoise(heard, sig, 20, s)
  if (bursts) {
    // loud 0.5 s noise bursts, on average one every 4 s
    const amp = Math.sqrt(sig) * 3
    for (let t = 0; t < heard.length;) {
      t += Math.round(-Math.log(rng(s, 'burst')() + 1e-12) * 4 * s.rate)
      for (let i = t; i < t + 0.5 * s.rate && i < heard.length; i++) heard[i] = amp * gauss(rng(s, 'burst'))
    }
  }
  const collector = new ChunkCollector()
  let decodedAt: number | undefined
  let pos = 0
  const rx = new Demodulator(s.rate, p => {
    if (decodedAt != null) return
    const msg = strategy === 'fountain' ? collector.add(p) : p
    if (msg != null && msg.length === message.length && msg.every((b, i) => b === message[i])) decodedAt = pos / s.rate
  }, opts)
  for (; pos < heard.length; pos += 4096) rx.push(heard.subarray(pos, pos + 4096))
  return decodedAt
}

// ---------- run ----------
// --opts '{"parity":32}': merge modem options into the chosen preset, to test a hypothesis without editing src/
const override: ModemOptions = args.opts != null ? JSON.parse(String(args.opts)) : {}
const presets = Object.entries(PRESETS).filter(([n]) => args.preset == null || args.preset === n).map(([n, o]) => [n, { ...o, ...override }]) as Array<[string, ModemOptions]>
const rows: string[][] = []
const joinRows: string[][] = []
const cpu: string[] = []
const meta: string[] = []
for (const [name, opts] of presets) {
  // the highest tone actually played: rotation adds up to (rotate-1)/rotate of a spacing above the listed tones
  const listed = (opts.toneSets ?? [opts.tones ?? PRESETS.voice.tones]).flat()
  const spacing = (opts.tones ?? PRESETS.voice.tones)[1] - (opts.tones ?? PRESETS.voice.tones)[0]
  const rotate = opts.rotate ?? 1
  const top = Math.max(...listed) + (rotate - 1) / rotate * spacing
  const rate = top > 6500 ? 48000 : 16000 // 16 kHz is plenty for tones below 6.5 kHz and 3x faster to simulate
  const tones = opts.tones ?? PRESETS.voice.tones
  const band: [number, number] = [Math.min(...tones) - 200, top + 200]
  const s: Sim = { rate, band, seed: Number(args.seed), trial: 0, streams: new Map() }
  const air = modulate(new Uint8Array(PAYLOAD), rate, opts).length / rate
  meta.push(`${name}: ${(PAYLOAD / air).toFixed(1)} B/s, ${air.toFixed(1)} s per ${PAYLOAD}-byte frame`)
  let cpuMs = 0; let cpuAudio = 0
  CONDITIONS.filter(([label]) => !args['late-only'] && (args.only == null || label.includes(args.only))).forEach(([label, channel], ci) => {
    let ok = 0; let both = 0
    for (let t = 0; t < TRIALS; t++) {
      s.trial = t; s.streams = new Map()
      const res = trial(opts, channel, s)
      if (res.ok) ok++
      if (res.both) both++
      if (ci === 0) { cpuMs += res.cpu; cpuAudio += res.audio }
    }
    rows[ci] ??= [label]
    // collision rows: our frame, and both frames (capture of one sender is not recovery)
    rows[ci].push(label.startsWith('collision') ? `${wilson(ok, TRIALS)}, both ${Math.round(100 * both / TRIALS)}%` : wilson(ok, TRIALS))
    process.stderr.write(`${name} | ${label}: ${ok}/${TRIALS}${label.startsWith('collision') ? ` (both ${both})` : ''}\n`)
  })
  const LATE: Array<[string, 'fountain' | 'repeat', boolean]> = [
    ['repeat whole frame, quiet', 'repeat', false],
    [`fountain ${BLOCK} B chunks, quiet`, 'fountain', false],
    ['repeat whole frame, noise bursts', 'repeat', true],
    [`fountain ${BLOCK} B chunks, noise bursts`, 'fountain', true]
  ]
  LATE.filter(([label]) => !args['no-late'] && (args.only == null || label.includes(args.only))).forEach(([label, strategy, bursts], ci) => {
    const times: number[] = []
    for (let t = 0; t < TRIALS; t++) {
      s.trial = t; s.streams = new Map()
      const d = lateJoin(opts, s, strategy, bursts)
      if (d != null) times.push(d)
    }
    times.sort((a, b) => a - b)
    joinRows[ci] ??= [label]
    joinRows[ci].push(`${wilson(times.length, TRIALS)}, median ${times.length > 0 ? times[Math.floor(times.length / 2)].toFixed(1) : '-'} s`)
    process.stderr.write(`${name} | ${label}: ${times.length}/${TRIALS}\n`)
  })
  cpu.push(`${name}: ${(cpuMs / cpuAudio).toFixed(1)} ms per audio second normal, ${hostileCpu(opts, s).toFixed(1)} ms under looped sync tones (sim rate ${rate / 1000} kHz)`)
}

const header = ['condition', ...presets.map(([n]) => n)]
const mdTable = (rs: string[][]): string => [header, header.map(() => '---'), ...rs].map(r => `| ${r.join(' | ')} |`).join('\n')
const table = mdTable(rows)
const md = `# Scorecard

Seed ${args.seed}, ${TRIALS} trials per cell, ${PAYLOAD}-byte frames, streamed in 4096-sample chunks.
Cells: frames decoded byte-exact, with Wilson 95% interval. Payloads, noise, rooms, colliders and join times each
draw from their own stream keyed by (seed, trial), so every preset meets the same rooms and payloads, a row's inputs
do not depend on which other rows ran, and another seed is a held-out set. Collision cells also give "both": the
share of trials where the other sender's frame decoded as well.

${meta.map(m => `- ${m}`).join('\n')}

${table}

## Late join

A transmitter loops one ${PAYLOAD}-byte message forever. A listener tunes in at a random moment and listens
for the same budget under both strategies: twice the whole-frame loop (about 23 s for voice). Cell: share decoded
within that budget, and median seconds from tuning in to decoding (successful trials only).
Noise bursts: 0.5 s of loud noise, on average every 4 s.

${mdTable(joinRows)}

CPU (this machine):
${cpu.map(c => `- ${c}`).join('\n')}
`
console.log(md)
if (args.out != null) writeFileSync(args.out, md)
