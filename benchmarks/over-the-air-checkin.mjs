// Check-in over the air: a host window asks who's here, N guest windows answer; speaker -> mic on this computer.
// Needs `npm run demo:checkin` running, Google Chrome, volume up. Run: node benchmarks/over-the-air-checkin.mjs [preset] [guests]
import { chromium } from 'playwright-core'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = process.env.URL ?? 'https://localhost:5175/'
const preset = process.argv[2] ?? 'ultrasonic'
const guests = Number(process.argv[3] ?? 2)

const b = await chromium.launch({ executablePath: CHROME, headless: false, args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
async function page (mode) {
  const ctx = await b.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone'] })
  await ctx.addInitScript(() => localStorage.clear())
  const p = await ctx.newPage()
  await p.goto(`${URL}?mode=${mode}&preset=${preset}`)
  await p.click('#start')
  await p.waitForFunction(() => document.querySelector('#me').textContent.length > 0)
  return p
}
const host = await page('host')
const gs = []
for (let i = 0; i < guests; i++) gs.push(await page('guest'))
await host.setChecked('#repeat', false)
const t0 = Date.now()
await host.click('#ask')
await host.waitForFunction(n => Number(document.querySelector('#count').textContent) >= n, guests, { timeout: 180000 }).catch(() => {})
console.log(`${preset}, ${guests} guests: ${await host.locator('#count').innerText()} checked in after ${((Date.now() - t0) / 1000).toFixed(0)} s`)
console.log((await host.locator('#list').innerText()).replace(/\n+/g, ' | '))
await b.close()
