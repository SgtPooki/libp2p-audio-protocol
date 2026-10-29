// Record what a guest page hears while a host announces, to a WAV, for offline decoding.
// Run: node benchmarks/over-the-air-tap.mjs 'jingle:westminster:-6:tune' /tmp/tap.wav [seconds]
import { chromium } from 'playwright-core'
import { writeFileSync } from 'node:fs'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = process.env.URL ?? 'https://localhost:5174/'
const [preset, out = '/tmp/tap.wav', seconds = '30'] = process.argv.slice(2)
const b = await chromium.launch({ executablePath: CHROME, headless: false, args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone'] })
const guest = await ctx.newPage()
await guest.goto(`${URL}?mode=guest&tap=1`)
await guest.click('#listen')
await guest.waitForFunction(() => document.querySelector('#guest-status').textContent.startsWith('listening'))
const host = await ctx.newPage()
await host.goto(`${URL}?mode=host&url=${encodeURIComponent('https://example.com/join/ABCD')}`)
const [kind, jingle, level, band] = preset.split(':')
for (const p of ['fast', 'voice', 'ultrasonic', 'music']) await host.setChecked(`#p-${p}`, p === preset)
if (kind === 'jingle') { await host.selectOption('#jingle', jingle); await host.fill('#level', level ?? '-18'); await host.selectOption('#band', band ?? 'ultrasonic') }
await host.click('#announce')
await guest.waitForTimeout(Number(seconds) * 1000)
await host.click('#stop')
const { rate, samples } = await guest.evaluate(() => window.__tap())
const pcm = new Int16Array(samples.length)
for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)))
const buf = Buffer.alloc(44 + pcm.length * 2)
buf.write('RIFF', 0); buf.writeUInt32LE(36 + pcm.length * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12)
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24)
buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(pcm.length * 2, 40)
Buffer.from(pcm.buffer).copy(buf, 44)
writeFileSync(out, buf)
console.log(`${out}: ${(samples.length / rate).toFixed(1)} s at ${rate} Hz; guest cards: ${await guest.locator('#cards .card').count()}`)
await b.close()
