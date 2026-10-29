// Audio QR over the air: a host window announces a link, a guest window listens on all presets.
// Needs `npm run demo:announce` running, Google Chrome, speaker volume up.
// Run: node benchmarks/over-the-air-announce.mjs [preset ...]   default: ultrasonic fast voice (one run each)
import { chromium } from 'playwright-core'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = process.env.URL ?? 'https://localhost:5174/'
// args: preset names, or jingle:<name>[:<dB>] for a link hidden under a synthesized tune
const presets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['ultrasonic', 'fast', 'voice']
const link = 'https://example.com/join/ABCD'

const b = await chromium.launch({ executablePath: CHROME, headless: false, args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone'] })
const guest = await ctx.newPage()
await guest.goto(`${URL}?mode=guest`)
await guest.click('#listen')
await guest.waitForFunction(() => document.querySelector('#guest-status').textContent.startsWith('listening'))
for (const preset of presets) {
  for (const signed of [false, true]) {
    const host = await ctx.newPage()
    await host.goto(`${URL}?mode=host&url=${encodeURIComponent(link)}`)
    const [kind, jingle, level, band] = preset.split(':') // jingle:<name>:<dB>:<ultrasonic|hidden>
    for (const p of ['fast', 'voice', 'ultrasonic', 'music']) await host.setChecked(`#p-${p}`, p === preset)
    if (kind === 'jingle') { await host.selectOption('#jingle', jingle); await host.fill('#level', level ?? '-18'); await host.selectOption('#band', band ?? 'ultrasonic') }
    await host.setChecked('#sign', signed)
    await guest.evaluate(() => { document.querySelector('#cards').innerHTML = '' })
    const t0 = Date.now()
    await host.click('#announce')
    try {
      await guest.waitForFunction(() => document.querySelector('#cards .card') != null, null, { timeout: 90000 })
      const card = await guest.locator('#cards .card small').innerText()
      console.log(`${preset} ${signed ? 'signed' : 'unsigned'}: link on the guest after ${((Date.now() - t0) / 1000).toFixed(1)} s (${card.replace(/\s+/g, ' ')})`)
    } catch { console.log(`${preset} ${signed ? 'signed' : 'unsigned'}: nothing heard in 90 s`) }
    await host.click('#stop')
    await host.close()
    await guest.waitForTimeout(1500)
  }
}
await b.close()
