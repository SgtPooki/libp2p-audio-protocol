// Simulated scorecard for the modem presets. Run: npm run scorecard
// bytes/s       payload bytes per second of air time (117-byte signed message)
// min SNR       lowest signal-to-noise ratio (dB, white noise over the whole band) with >= 9/10 frames decoded
// dropout       frames decoded out of 10 when a burst of audio of that length is lost at a random spot
import { modulate, Demodulator, PRESETS, type ModemOptions } from '../src/modem.ts'

const rate = 48000
const TRIALS = 10
const rand = (n: number): Uint8Array => Uint8Array.from({ length: n }, () => Math.random() * 256)

function decodes (opts: ModemOptions, distort: (wave: Float32Array) => Float32Array): number {
  let ok = 0
  for (let t = 0; t < TRIALS; t++) {
    const payload = rand(117)
    const wave = modulate(payload, rate, opts)
    const padded = new Float32Array(wave.length + rate)
    padded.set(wave, rate / 2)
    let got = false
    new Demodulator(rate, p => { got = p.every((b, i) => b === payload[i]) }, opts).push(distort(padded))
    if (got) ok++
  }
  return ok
}

const power = (x: Float32Array): number => x.reduce((s, v) => s + v * v, 0) / x.length

function withNoise (snrDb: number) {
  return (x: Float32Array): Float32Array => {
    const sigma = Math.sqrt(power(x) / 10 ** (snrDb / 10))
    // Box-Muller gaussian noise
    return x.map(v => v + sigma * Math.sqrt(-2 * Math.log(Math.random() + 1e-12)) * Math.cos(2 * Math.PI * Math.random()))
  }
}

function withDropout (seconds: number) {
  return (x: Float32Array): Float32Array => {
    const y = x.slice()
    const len = Math.round(seconds * rate)
    const at = rate / 2 + Math.floor(Math.random() * (x.length - rate - len))
    y.fill(0, at, at + len)
    return y
  }
}

const rows: Record<string, Record<string, string>> = {}
for (const [name, opts] of Object.entries(PRESETS) as Array<[string, ModemOptions]>) {
  const air = modulate(rand(117), rate, opts).length / rate
  let minSnr = 'n/a'
  for (let snr = 10; snr >= -20; snr -= 2) {
    if (decodes(opts, withNoise(snr)) < 9) break
    minSnr = `${snr} dB`
  }
  rows[name] = {
    'bytes/s': (117 / air).toFixed(1),
    'air s': air.toFixed(1),
    'min SNR': minSnr,
    'drop 0.1s': `${decodes(opts, withDropout(0.1))}/${TRIALS}`,
    'drop 0.3s': `${decodes(opts, withDropout(0.3))}/${TRIALS}`,
    'drop 1s': `${decodes(opts, withDropout(1))}/${TRIALS}`
  }
}
console.table(rows)
