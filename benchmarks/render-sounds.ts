// Render one signed "hello" frame per preset to benchmarks/sounds/<preset>.wav, so you can hear what
// each preset sounds like without a speaker test. Run: node benchmarks/render-sounds.ts [preset ...]
import { writeFileSync } from 'node:fs'
import { modulate, PRESETS, type Preset } from '../src/modem.ts'

const rate = 16000
const payload = Uint8Array.from({ length: 117 }, (_, i) => (i * 97 + 13) & 0xff) // the size of a signed hello
const names = (process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(PRESETS)) as Preset[]
for (const name of names) {
  if (name === 'ultrasonic') continue // nothing to hear, and 16 kHz can't carry it
  const wave = modulate(payload, rate, PRESETS[name])
  const pcm = new Int16Array(wave.length)
  for (let i = 0; i < wave.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(wave[i] * 32767)))
  const buf = Buffer.alloc(44 + pcm.length * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + pcm.length * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(pcm.length * 2, 40)
  Buffer.from(pcm.buffer).copy(buf, 44)
  writeFileSync(`benchmarks/sounds/${name}.wav`, buf)
  console.log(`${name}: ${(wave.length / rate).toFixed(1)} s -> benchmarks/sounds/${name}.wav`)
}
