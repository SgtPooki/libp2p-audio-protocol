// Over-the-air benchmark: a visible Chrome page sends N signed messages through this computer's
// speaker; listener pages decode them from real microphones.
// Needs: `npm run demo` running, Google Chrome installed, speaker volume up.
// Run:   node bench/over-the-air.mjs [config ...]      e.g. preset=voice preset=voice&symbolSeconds=0.03
// Env:   MICS="MacBook Pro Microphone,RussellPhone" (substrings of input device labels), N=5
// Headless Chrome plays no audio, so windows will appear.
import { chromium } from 'playwright-core'

const N = Number(process.env.N ?? 5)
const MICS = (process.env.MICS ?? 'MacBook Pro Microphone').split(',')
const CONFIGS = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['preset=voice', 'preset=chime', 'preset=ultrasonic']
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = process.env.URL ?? 'https://localhost:5173/'

const b = await chromium.launch({ executablePath: CHROME, headless: false, args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
async function page (config, mic) {
  const ctx = await b.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone'] })
  if (mic != null) {
    await ctx.addInitScript(m => {
      const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async c => {
        (await orig({ audio: true })).getTracks().forEach(t => t.stop())
        const d = (await navigator.mediaDevices.enumerateDevices()).find(d => d.kind === 'audioinput' && d.label.includes(m))
        if (d == null) throw new Error('mic not found: ' + m)
        return orig({ audio: { ...c.audio, deviceId: { exact: d.deviceId } } })
      }
    }, mic)
  }
  const p = await ctx.newPage()
  await p.goto(`${URL}?${config}`)
  await p.click('#start')
  await p.waitForSelector('#app:not([hidden])', { timeout: 10000 })
  return p
}

for (const config of CONFIGS) {
  const tx = await page(config)
  const rxs = []
  for (const mic of MICS) rxs.push([mic, await page(config, mic).catch(e => { console.log(`${mic}: ${e.message}`); return null })])
  const t0 = Date.now()
  for (let i = 0; i < N; i++) {
    await tx.fill('#text', `bench ${i}`)
    await tx.click('#form button:not([type])')
    await tx.waitForFunction(() => !document.querySelector('#announce').disabled, null, { timeout: 120000 })
    await tx.waitForTimeout(800)
  }
  await tx.waitForTimeout(1500)
  const res = []
  for (const [mic, rx] of rxs) {
    if (rx == null) continue
    res.push(`${mic} ${new Set((await rx.locator('#log').innerText()).match(/bench \d/g)).size}/${N}`)
  }
  console.log(`${config}: ~${((Date.now() - t0) / N / 1000).toFixed(1)} s/msg | ${res.join(' | ')}`)
  for (const p of [tx, ...rxs.map(([, rx]) => rx)]) if (p != null) await p.context().close()
}
await b.close()
