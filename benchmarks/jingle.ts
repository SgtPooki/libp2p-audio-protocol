// Data under a public-domain jingle: which melody, which preset and how quiet can the data be?
// Run: node benchmarks/jingle.ts [--trials 30] [--out benchmarks/JINGLE.md] [--wav]
// Each cell: share of 60-byte frames decoded with the data mixed `level` dB under the looping jingle,
// with a 20 dB in-band noise floor; the reverb column adds RT60 0.3 s at DRR 0 dB.
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { modulate, Demodulator, PRESETS, type ModemOptions, type Preset } from '../src/modem.ts'
import { JINGLES, renderJingle, underJingle } from '../src/jingle.ts'

const { values: args } = parseArgs({ options: { trials: { type: 'string', default: '30' }, out: { type: 'string' }, wav: { type: 'boolean', default: false } } })
const TRIALS = Number(args.trials)
const LEVELS = [-6, -12, -18, -24]
const PRESET_ROWS: Preset[] = ['hidden', 'fast', 'voice', 'ultrasonic']
let seed = 1
const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
const gauss = (): number => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd())

function reverb (x: Float32Array, rate: number): Float32Array {
  const taps: Array<[number, number]> = []
  for (let k = 0; k < 40; k++) { const t = 0.002 + rnd() * 0.3; taps.push([Math.round(t * rate), (rnd() < 0.5 ? -1 : 1) * Math.exp(-6.9 * t / 0.3)]) }
  const norm = Math.sqrt(taps.reduce((e, [, a]) => e + a * a, 0))
  const out = x.slice()
  for (const [d, a] of taps) for (let i = d; i < x.length; i++) out[i] += a / norm * x[i - d]
  return out
}

/** A noisy room: someone else's music (another of the jingles, same loudness as ours, out of step) and a loud noise floor. */
function noisyRoom (x: Float32Array, jingle: keyof typeof JINGLES, rate: number): Float32Array {
  const others = Object.keys(JINGLES).filter(k => k !== jingle)
  const other = renderJingle(JINGLES[others[Math.floor(rnd() * others.length)]], rate)
  const off = Math.floor(rnd() * other.length)
  let sx = 0; let so = 0
  for (const v of x) sx += v * v
  for (const v of other) so += v * v
  const g = Math.sqrt((sx / x.length) / (so / other.length))
  const out = x.slice()
  for (let i = 0; i < out.length; i++) out[i] += g * other[(i + off) % other.length] + 0.08 * gauss()
  return out
}

function score (jingle: keyof typeof JINGLES, preset: Preset, level: number, cond: 'quiet' | 'reverb' | 'noisy'): number {
  const opts = PRESETS[preset] as ModemOptions
  const rate = preset === 'ultrasonic' ? 48000 : 16000
  let ok = 0
  for (let t = 0; t < TRIALS; t++) {
    const payload = Uint8Array.from({ length: 60 }, () => rnd() * 256)
    const data = modulate(payload, rate, opts)
    let mixed = underJingle(data, JINGLES[jingle], rate, level)
    if (cond === 'reverb') mixed = reverb(mixed, rate)
    if (cond === 'noisy') mixed = noisyRoom(mixed, jingle, rate)
    const noise = 0.01
    const heard = new Float32Array(mixed.length + rate).map((_, i) => (mixed[i - rate / 2] ?? 0) + noise * gauss())
    let got = false
    const rx = new Demodulator(rate, p => { got = p.length === 60 && p.every((b, i) => b === payload[i]) }, opts)
    for (let i = 0; i < heard.length; i += 4096) rx.push(heard.subarray(i, i + 4096))
    if (got) ok++
  }
  return ok / TRIALS
}

const lines: string[] = []
for (const [key, j] of Object.entries(JINGLES)) {
  lines.push(`\n### ${j.name} (\`${key}\`, ${(renderJingle(j, 16000).length / 16000).toFixed(1)} s loop)\n`)
  const CONDS = ['quiet', 'reverb', 'noisy'] as const
  lines.push(`| preset | ${CONDS.flatMap(c => LEVELS.map(l => `${l} dB${c === 'quiet' ? '' : ' ' + c}`)).join(' | ')} |`)
  lines.push(`| --- | ${CONDS.flatMap(() => LEVELS.map(() => '---')).join(' | ')} |`)
  for (const preset of PRESET_ROWS) {
    const cells = CONDS.flatMap(c => LEVELS.map(l => `${Math.round(100 * score(key as keyof typeof JINGLES, preset, l, c))}%`))
    lines.push(`| ${preset} | ${cells.join(' | ')} |`)
    process.stderr.write(`${key} ${preset}: ${cells.join(' ')}\n`)
  }
}
const md = `# Data under a jingle

\`node benchmarks/jingle.ts\`, ${TRIALS} trials per cell. A 60-byte frame (a link, a room code) is mixed under a looping
public-domain melody synthesized in \`src/jingle.ts\`, at the given level below the melody's RMS, plus a quiet noise floor.
"reverb" adds RT60 0.3 s at DRR 0 dB; "noisy" adds someone else's music at the same loudness as ours (another of the
jingles, out of step) and a loud noise floor. Cell: frames decoded byte-exact. More negative = quieter data.
${lines.join('\n')}
`
console.log(md)
if (args.out != null) writeFileSync(args.out, md)
if (args.wav) {
  const wav = (name: string, x: Float32Array, rate: number): void => {
    const pcm = new Int16Array(x.length)
    for (let i = 0; i < x.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767)))
    const buf = Buffer.alloc(44 + pcm.length * 2)
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + pcm.length * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12)
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24)
    buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(pcm.length * 2, 40)
    Buffer.from(pcm.buffer).copy(buf, 44)
    writeFileSync(`benchmarks/sounds/${name}.wav`, buf)
  }
  const payload = new TextEncoder().encode('https://example.com/join/ABCD')
  for (const [key, j] of Object.entries(JINGLES)) {
    wav(`jingle-${key}`, renderJingle(j, 16000), 16000)
    wav(`jingle-${key}-hidden-18dB`, underJingle(modulate(payload, 16000, PRESETS.hidden), j, 16000, -18), 16000)
  }
}
