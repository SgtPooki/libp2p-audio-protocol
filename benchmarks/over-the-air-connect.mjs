// Over-the-air libp2p connection: two visible Chrome pages on this computer, speaker -> microphone.
// Page A announces, page B discovers it, dials /audio over sound, opens a chat stream and pings.
// Needs: `npm run demo` running, Google Chrome installed, speaker volume up, a quiet room.
// Run:   node benchmarks/over-the-air-connect.mjs [query]     e.g. preset=voice&symbolSeconds=0.03
import { chromium } from 'playwright-core'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = process.env.URL ?? 'https://localhost:5173/'
const config = process.argv[2] ?? 'preset=voice'

const b = await chromium.launch({ executablePath: CHROME, headless: false, args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
async function page () {
  const ctx = await b.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone'] })
  await ctx.addInitScript(() => localStorage.clear()) // fresh identity per page
  const p = await ctx.newPage()
  await p.goto(`${URL}?${config}`)
  await p.click('#start')
  await p.waitForSelector('#app:not([hidden])', { timeout: 10000 })
  return p
}
const logText = async p => p.locator('#log').innerText()

const a = await page()
const bPage = await page()
const t0 = Date.now()
await a.click('#announce')
await bPage.waitForFunction(() => !document.querySelector('#connect').disabled, null, { timeout: 60000 })
console.log(`discovered after ${((Date.now() - t0) / 1000).toFixed(0)} s`)
const t1 = Date.now()
await bPage.click('#connect')
await bPage.waitForFunction(() => document.querySelector('#log').innerText.includes('connected in'), null, { timeout: 600000 })
console.log(`connected after ${((Date.now() - t1) / 1000).toFixed(0)} s`)
await bPage.waitForFunction(() => document.querySelector('#log').innerText.includes('ping'), null, { timeout: 300000 })
await bPage.fill('#text', 'over the air, encrypted')
await bPage.click('#form button:not([type])')
await a.waitForFunction(() => document.querySelector('#log').innerText.includes('over the air, encrypted'), null, { timeout: 300000 })
console.log(`chat delivered after ${((Date.now() - t0) / 1000).toFixed(0)} s total`)
console.log('--- B log ---\n' + await logText(bPage))
console.log('--- A log ---\n' + await logText(a))
await b.close()
